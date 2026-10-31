import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { decodePolyline, encodePolyline, type LatLon, centroid, routeCells } from "./geometry.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";
import type { NewRide, RideExtras, Store } from "./store.ts";
import { haversineKm } from "./tools/geo.ts";

/** The largest roadbook file a rider may send, and how many sent roadbooks a library keeps. */
export const MAX_PUSHED_BYTES = 5 * 1024 * 1024;
export const MAX_PUSHED = 100;
/** The request recorded on a roadbook made from a file, so a later push of the same roadbook replaces it. */
const KEY_PREFIX = "roadbook file ";
/** A loop when the file ends this close to where it starts, km. */
const LOOP_KM = 0.5;

export class PushRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface FileStop {
  lat: number;
  lon: number;
  name: string;
  kind?: string;
}
interface FileLimit {
  from: number;
  to: number;
  kmh: number;
  road?: string;
}
interface FileCamera {
  lat: number;
  lon: number;
  kmh: number | null;
  bearing: number | null;
  direction: string | null;
}

const lengthKm = (points: LatLon[]): number => {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1]!, points[i]!);
  return km;
};

/** Index of the point of `line` nearest to `at`, looking forward from `from`. */
function nearestIndex(line: LatLon[], at: LatLon, from: number): number {
  let best = from;
  let bestKm = Infinity;
  for (let i = from; i < line.length; i++) {
    const d = haversineKm(line[i]!, at);
    if (d < bestKm) {
      bestKm = d;
      best = i;
    }
  }
  return best;
}

/** The text that says which roadbook of which library a file is, so pushing it again replaces it. */
function keyOf(file: Record<string, unknown>, name: string): string {
  const origin = file["origin"] as { app?: unknown; roadbook?: unknown; name?: unknown } | undefined;
  return origin && typeof origin === "object" && Number.isInteger(origin.roadbook) && typeof origin.name === "string"
    ? `${KEY_PREFIX}${String(origin.app)}:${String(origin.roadbook)}:${origin.name}`
    : `${KEY_PREFIX}name:${name}`;
}

/**
 * Makes a roadbook of the library from a roadbook file, as if the rider had planned it there: the line (cut into legs at the
 * waypoints), the waypoints, the cameras. The speed limits, countries and roundabouts are not kept: they are traced again, on the
 * server's map, when the file is made for the phone. Planned fuel and pause stops are not kept either (a refresh plans them from the
 * rider's bike profile). A file that says which roadbook it is (`origin`) replaces the earlier push of the same, keeping the previous
 * version; an unchanged file changes nothing. Throws PushRefused for a body that is not a roadbook file.
 */
export function importRoadbookFile(store: Store, doc: unknown): { id: number; replaced: boolean } {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) throw new PushRefused(400, "Not a roadbook file.");
  const file = doc as Record<string, unknown>;
  if (file["format"] !== "motoride-roadbook") throw new PushRefused(400, "Not a motoride-roadbook file.");
  if (file["version"] !== 1) throw new PushRefused(400, "Only version 1 of the roadbook file is known.");
  const name = file["name"];
  if (typeof name !== "string" || !name.trim() || name.length > 200)
    throw new PushRefused(400, "The roadbook file needs a name.");
  const encoded = file["line"];
  const line = typeof encoded === "string" ? decodePolyline(encoded) : [];
  if (line.length < 2 || typeof encoded !== "string")
    throw new PushRefused(400, "The roadbook file needs a line of at least two points.");

  const stops = (Array.isArray(file["stops"]) ? file["stops"] : []) as FileStop[];
  const limits = (Array.isArray(file["limits"]) ? file["limits"] : []) as FileLimit[];
  const cameras = (Array.isArray(file["cameras"]) ? file["cameras"] : []) as FileCamera[];
  const first = line[0]!;
  const last = line.at(-1)!;
  const label = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

  // The waypoints of the loop, in riding order, with the line's own ends as the first and last.
  const marks: Array<{ name: string; at: LatLon; index: number }> = [];
  let from = 0;
  for (const stop of stops.filter((s) => s.kind !== "stop" && Number.isFinite(s.lat) && Number.isFinite(s.lon))) {
    const index = nearestIndex(line, stop, from);
    marks.push({ name: String(stop.name).slice(0, 120) || label(stop), at: stop, index });
    from = index;
  }
  if (marks.length < 2) {
    marks.length = 0;
    marks.push({ name: label(first), at: first, index: 0 }, { name: label(last), at: last, index: line.length - 1 });
  } else {
    marks[0]!.index = 0;
    marks[marks.length - 1]!.index = line.length - 1;
  }

  // One leg per pair of waypoints; a line with no usable waypoints is one leg.
  const shapes: string[] = [];
  const legs: NewRide["legs"] = [];
  const estimate = (a: number, b: number): number => {
    let minutes = 0;
    for (const l of limits) {
      const s = Math.max(a, l.from);
      const e = Math.min(b, l.to);
      if (e > s && l.kmh > 0) minutes += (lengthKm(line.slice(s, e + 1)) / (l.kmh * 0.75)) * 60;
    }
    const covered = limits.length ? minutes : 0;
    return Math.round(covered || (lengthKm(line.slice(a, b + 1)) / 52) * 60);
  };
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i]!;
    const b = marks[i + 1]!;
    const slice = line.slice(a.index, Math.max(b.index, a.index + 1) + 1);
    shapes.push(marks.length === 2 ? encoded : encodePolyline(slice));
    const roads = new Map<string, number>();
    for (const l of limits) {
      if (!l.road || l.to <= a.index || l.from >= b.index) continue;
      roads.set(
        l.road,
        (roads.get(l.road) ?? 0) + lengthKm(line.slice(Math.max(l.from, a.index), Math.min(l.to, b.index) + 1)),
      );
    }
    legs.push({
      seq: i + 1,
      from: a.name,
      to: b.name,
      fromCoords: `${a.at.lat},${a.at.lon}`,
      toCoords: `${b.at.lat},${b.at.lon}`,
      distanceKm: Math.round(lengthKm(slice) * 10) / 10,
      ridingMinutes: estimate(a.index, b.index),
      mainRoads: [...roads]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 4)
        .map(([road]) => road),
    });
  }
  const distanceKm = Math.round(lengthKm(line) * 10) / 10;
  const described = /about (\d+)h(\d{2})/.exec(typeof file["description"] === "string" ? file["description"] : "");
  const ridingMinutes = described
    ? Number(described[1]) * 60 + Number(described[2])
    : legs.reduce((s, l) => s + l.ridingMinutes, 0);
  const waypointNames = marks.map((m) => m.name);

  // Cameras as the library keeps them: how far along the route, which leg, the limit, the direction and the place.
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1]! + haversineKm(line[i - 1]!, line[i]!));
  const extras: RideExtras = {
    gatheredAt: new Date().toISOString(),
    daylight: null,
    cameras: cameras
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
      .map((c) => {
        const index = nearestIndex(line, c, 0);
        return {
          kmAlongRoute: Math.round(cum[index]! * 10) / 10,
          leg: Math.max(
            1,
            marks.findIndex((m, k) => index >= m.index && index <= (marks[k + 1]?.index ?? Infinity)) + 1,
          ),
          limitKmh: c.kmh,
          direction: c.bearing !== null && c.bearing !== undefined ? String(c.bearing) : c.direction,
          coords: `${c.lat},${c.lon}`,
        };
      }),
    stops: {},
    errors: {},
  };

  const key = keyOf(file, name);
  const centre = centroid(line);
  const design = {
    waypoints: waypointNames,
    roundTrip: haversineKm(first, last) < LOOP_KM,
    preferences: DEFAULT_PREFERENCES,
    itinerary: `${typeof file["description"] === "string" ? file["description"] : name}\n\nWaypoints: ${waypointNames.join(" → ")}`,
    distanceKm,
    ridingMinutes,
    speedLimits: {},
    mapsUrl: `https://www.google.com/maps/dir/${marks.map((m) => `${m.at.lat},${m.at.lon}`).join("/")}`,
    cells: routeCells(shapes),
    shapes,
    centerLat: centre.lat,
    centerLon: centre.lon,
    legs,
  };

  const rides = store.listRides();
  const earlier = rides.find((r) => r.request === key);
  if (earlier) {
    const unchanged =
      JSON.stringify(earlier.shapes) === JSON.stringify(shapes) &&
      earlier.name === name &&
      JSON.stringify(earlier.waypoints) === JSON.stringify(waypointNames) &&
      JSON.stringify(earlier.extras?.cameras ?? []) === JSON.stringify(extras.cameras);
    if (!unchanged) {
      store.reviseRoadbook(earlier.id, { ...design, name }, key);
      store.setExtras(earlier.id, extras);
    }
    return { id: earlier.id, replaced: true };
  }
  if (rides.filter((r) => r.request.startsWith(KEY_PREFIX)).length >= MAX_PUSHED)
    throw new PushRefused(409, `This server keeps at most ${MAX_PUSHED} sent roadbooks; delete one first.`);
  const id = store.saveRide({
    ...design,
    name,
    parentId: null,
    home: waypointNames[0]!,
    rideDate: null,
    departure: null,
    request: key,
    usage: null,
    extras,
  });
  return { id, replaced: false };
}

/**
 * Roadbooks that were pushed when the server kept them as files (a `pushed` folder next to the library) are made roadbooks of the
 * library, once; the folder is then renamed `pushed.imported`, kept as it was. Returns how many were brought in.
 */
export function importLegacyPushed(store: Store, dir: string): number {
  const index = join(dir, "index.json");
  if (!existsSync(index)) return 0;
  let count = 0;
  try {
    const items = (JSON.parse(readFileSync(index, "utf8")) as { items?: Array<{ id: number }> }).items ?? [];
    for (const { id } of items) {
      try {
        importRoadbookFile(store, JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")));
        count++;
      } catch (e) {
        console.error(`[roadbook import] pushed file ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    renameSync(dir, existsSync(`${dir}.imported`) ? `${dir}.imported-${Date.now()}` : `${dir}.imported`);
  }
  return count;
}
