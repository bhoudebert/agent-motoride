import { decodePolyline, type LatLon } from "../geometry.ts";
import { fmtCoords, haversineKm } from "./geo.ts";
import { overpass } from "./roads.ts";
import type { TripLeg } from "./trip.ts";

/** Route line as points with their distance from the start, per leg. */
interface RoutePoint extends LatLon {
  km: number;
  leg: number;
}

function routePoints(shapes: string[]): RoutePoint[] {
  const points: RoutePoint[] = [];
  let km = 0;
  shapes.forEach((shape, legIndex) => {
    const decoded = decodePolyline(shape);
    decoded.forEach((p, i) => {
      if (i > 0) km += haversineKm(decoded[i - 1]!, p);
      points.push({ ...p, km, leg: legIndex + 1 });
    });
  });
  return points;
}

/** Every ~`stepKm` along the line, for an Overpass "around a line" filter. */
function simplify(points: RoutePoint[], stepKm: number): RoutePoint[] {
  const kept: RoutePoint[] = [];
  let next = 0;
  for (const p of points) {
    if (p.km >= next) {
      kept.push(p);
      next = p.km + stepKm;
    }
  }
  if (kept.at(-1) !== points.at(-1)) kept.push(points.at(-1)!);
  return kept;
}

function nearest(points: RoutePoint[], poi: LatLon): { km: number; leg: number; distanceM: number } {
  let best = points[0]!;
  let bestKm = Infinity;
  for (const p of points) {
    const d = haversineKm(p, poi);
    if (d < bestKm) {
      bestKm = d;
      best = p;
    }
  }
  return { km: Number(best.km.toFixed(1)), leg: best.leg, distanceM: Math.round(bestKm * 1000) };
}

interface Element {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function alongRoute(points: RoutePoint[], filters: string[], radiusM: number): Promise<Element[]> {
  // Overpass measures the distance to the line between the points, so a point
  // every 600 m follows the road closely enough. The route goes in chunks of
  // about 25 km; a chunk the server cannot answer in time (dense areas) is
  // split in two and retried, down to a few km.
  const sparse = simplify(points, 0.6);
  const seen = new Map<string, Element>();
  const query = async (chunk: RoutePoint[], depth: number): Promise<void> => {
    const line = chunk.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(",");
    const union = filters.map((filter) => `nwr${filter}(around:${radiusM},${line});`).join("");
    const started = Date.now();
    try {
      const elements = await overpass<Element & { id?: number }>(`[out:json][timeout:30];(${union});out center tags;`, { quick: depth < 3 });
      for (const e of elements) seen.set(`${e.type}/${e.id}`, e);
      process.stderr.write(`\x1b[2m     map chunk km ${chunk[0]!.km.toFixed(0)}-${chunk.at(-1)!.km.toFixed(0)}: ${elements.length} found, ${Date.now() - started} ms\x1b[0m\n`);
    } catch (error) {
      process.stderr.write(`\x1b[2m     map chunk km ${chunk[0]!.km.toFixed(0)}-${chunk.at(-1)!.km.toFixed(0)}: failed after ${Date.now() - started} ms${chunk.length >= 8 && depth < 3 ? ", splitting" : ""}\x1b[0m\n`);
      if (chunk.length < 8 || depth >= 3) throw error;
      const half = Math.ceil(chunk.length / 2);
      await query(chunk.slice(0, half + 1), depth + 1);
      await query(chunk.slice(half), depth + 1);
    }
  };
  const chunkSize = 40;
  for (let start = 0; start < sparse.length - 1; start += chunkSize - 1) {
    await query(sparse.slice(start, start + chunkSize), 0);
  }
  return [...seen.values()];
}

const position = (e: Element) => (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : e.center);

/**
 * Fixed speed cameras mapped in OpenStreetMap on or next to the route. Fixed
 * installations only: mobile controls are not in the map. Coverage depends on
 * mappers; a missing camera is not proof of absence.
 */
export async function speedCamerasAlong(shapes: string[], legs: TripLeg[]) {
  const points = routePoints(shapes);
  const elements = await alongRoute(points, ['["highway"="speed_camera"]'], 60);
  const cameras = elements
    .flatMap((e) => {
      const at = position(e);
      if (!at) return [];
      const where = nearest(points, at);
      const tags = e.tags ?? {};
      return [
        {
          kmAlongRoute: where.km,
          leg: where.leg,
          between: legs[where.leg - 1] ? `${legs[where.leg - 1]!.from} -> ${legs[where.leg - 1]!.to}` : "",
          limitKmh: tags.maxspeed ? Number.parseInt(tags.maxspeed, 10) || tags.maxspeed : null,
          direction: tags.direction ?? null,
          type: tags["speed_camera:type"] ?? tags.camera_type ?? null,
          coords: fmtCoords(at),
        },
      ];
    })
    .sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
  return {
    count: cameras.length,
    cameras,
    note: "Fixed cameras from OpenStreetMap only; mobile controls and average-speed sections are not covered, and unmapped cameras are not shown. In France, pass this on as zones to watch rather than exact positions.",
  };
}

export type StopKind = "fuel" | "cafe" | "restaurant" | "bakery";

const STOP_TAGS: Record<StopKind, { key: string; value: string }> = {
  fuel: { key: "amenity", value: "fuel" },
  cafe: { key: "amenity", value: "cafe" },
  restaurant: { key: "amenity", value: "restaurant" },
  bakery: { key: "shop", value: "bakery" },
};

/** One regex filter per tag key: far cheaper for the server than one filter per kind. */
function stopFilters(kinds: StopKind[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const kind of kinds) {
    const { key, value } = STOP_TAGS[kind];
    byKey.set(key, [...(byKey.get(key) ?? []), value]);
  }
  return [...byKey.entries()].map(([key, values]) => (values.length === 1 ? `["${key}"="${values[0]}"]` : `["${key}"~"^(${values.join("|")})$"]`));
}

/**
 * Keep at most `limit` stops spread along the route: the best of each stretch
 * (named, then smallest detour), then the best leftovers. A plain cut by
 * distance would list only the first town's stops.
 */
function spread<T extends { kmAlongRoute: number; name: string; detourM: number }>(stops: T[], totalKm: number, limit: number): T[] {
  if (stops.length <= limit) return stops;
  const score = (s: T) => (s.name.endsWith("(unnamed)") ? 10_000 : 0) + s.detourM;
  const bucketKm = totalKm / limit;
  const chosen = new Set<T>();
  for (let i = 0; i < limit; i++) {
    const inBucket = stops.filter((s) => s.kmAlongRoute >= i * bucketKm && s.kmAlongRoute < (i + 1) * bucketKm);
    const best = inBucket.sort((a, b) => score(a) - score(b))[0];
    if (best) chosen.add(best);
  }
  for (const s of [...stops].sort((a, b) => score(a) - score(b))) {
    if (chosen.size >= limit) break;
    chosen.add(s);
  }
  return [...chosen].sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
}

/**
 * Fuel stations, cafés, restaurants and bakeries near the route, ordered by
 * distance from the start, so stops can be planned by tank range and timing.
 */
export async function stopsAlong(shapes: string[], legs: TripLeg[], kinds: StopKind[], radiusM: number, limitPerKind: number) {
  const points = routePoints(shapes);
  const totalKm = points.at(-1)?.km ?? 0;
  const result: Record<string, unknown> = { totalKm: Number(totalKm.toFixed(1)) };
  // One query for every kind, then sort the elements by their tags.
  const elements = await alongRoute(points, stopFilters(kinds), radiusM);
  const kindOf = (tags: Record<string, string>): StopKind | undefined =>
    tags.amenity === "fuel" ? "fuel" : tags.amenity === "cafe" ? "cafe" : tags.amenity === "restaurant" ? "restaurant" : tags.shop === "bakery" ? "bakery" : undefined;
  for (const kind of kinds) {
    const stops = elements
      .filter((e) => kindOf(e.tags ?? {}) === kind)
      .flatMap((e) => {
        const at = position(e);
        if (!at) return [];
        const where = nearest(points, at);
        const tags = e.tags ?? {};
        return [
          {
            kmAlongRoute: where.km,
            leg: where.leg,
            name: tags.name ?? tags.brand ?? `${kind} (unnamed)`,
            brand: tags.brand ?? null,
            openingHours: tags.opening_hours ?? null,
            detourM: where.distanceM,
            place: tags["addr:city"] ?? tags["addr:village"] ?? tags["addr:town"] ?? null,
            street: tags["addr:street"] ?? null,
            coords: fmtCoords(at),
          },
        ];
      })
      .sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
    const chosen = spread(stops, totalKm, limitPerKind);
    result[kind] = { found: stops.length, listed: chosen.length, stops: chosen, legsHint: legs.map((l, i) => `${i + 1}: ${l.from} -> ${l.to}`) };
  }
  return result;
}
