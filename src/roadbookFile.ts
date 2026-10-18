import { decodePolyline, encodePolyline, type LatLon } from "./geometry.ts";
import { haversineKm } from "./tools/geo.ts";
import { effectiveLimit, traceLeg, type TraceAttributesResponse } from "./tools/trip.ts";

/** The `motoride-roadbook` file read by the MobileMotoRide app (docs/roadbook-file.md). */
export const ROADBOOK_FORMAT = "motoride-roadbook";
export const ROADBOOK_VERSION = 1;

export interface RoadbookFile {
  format: typeof ROADBOOK_FORMAT;
  version: typeof ROADBOOK_VERSION;
  name: string;
  description: string;
  generatedAt: string;
  /** All legs joined in riding order, encoded polyline of precision 6. */
  line: string;
  stops: Array<{ lat: number; lon: number; name: string }>;
  /** Speed limit per stretch, by index into the decoded line: from point `from` to point `to`. */
  limits: Array<{ from: number; to: number; kmh: number; posted: boolean; road?: string }>;
  cameras: Array<{ lat: number; lon: number; kmh: number | null; bearing: number | null; direction: "both" | null }>;
}

export interface RoadbookFileInput {
  name: string;
  description: string;
  legs: Array<{ from: string; to: string; fromCoords: string; toCoords: string }>;
  /** One encoded polyline per leg, as routed. */
  shapes: string[];
  /** Planned fuel and pause stops, with their place along the route. */
  stops?: Array<{ lat: number; lon: number; label: string; km?: number }>;
  /** Fixed cameras gathered for the ride. */
  cameras?: Array<{ limitKmh: number | string | null; direction: string | null; coords: string }>;
}

type Trace = (shape: string) => Promise<TraceAttributesResponse>;

const parseCoords = (coords: string): LatLon => {
  const [lat = 0, lon = 0] = coords.split(",").map(Number);
  return { lat, lon };
};

/** The road ref ("D 518") before the street name when both are tagged, as in the road statistics. */
const roadLabel = (names: string[] | undefined) => names?.find((n) => /^[A-Z]{1,2} ?\d/.test(n)) ?? names?.[0];

/** First number of a camera limit such as 50, "50" or "50;70"; null when there is none. */
function cameraKmh(limit: number | string | null): number | null {
  if (typeof limit === "number") return limit > 0 ? limit : null;
  const n = Number(/\d+/.exec(String(limit ?? ""))?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/**
 * The direction a camera faces, degrees clockwise from north, from OpenStreetMap's `direction` when it is degrees or a
 * compass point. `forward`, `backward` and `both` are relative to the way, not to a compass, so they give null; so do
 * several values at once ("90;270"), which cannot be one direction.
 */
export function cameraBearing(direction: string | null | undefined): number | null {
  const d = direction?.trim().toUpperCase();
  if (!d) return null;
  const point = COMPASS.indexOf(d);
  if (point >= 0) return point * 22.5;
  if (/^\d{1,3}(\.\d+)?$/.test(d)) {
    const deg = Number(d);
    return deg >= 0 && deg <= 360 ? deg % 360 : null;
  }
  return null;
}

function lengthKm(points: LatLon[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1]!, points[i]!);
  return km;
}

/**
 * The roadbook file of a ride: the routed line, a speed limit per stretch (posted by OpenStreetMap or assumed from
 * the country default), the stops in riding order and the fixed cameras.
 *
 * The line is the one Valhalla traced, not the one routed, so the limit indexes refer to the points written. When a
 * leg cannot be traced its routed shape is used and it has no limits; `limitsError` says so. The file is still made.
 */
export async function buildRoadbookFile(
  input: RoadbookFileInput,
  trace: Trace = traceLeg,
): Promise<{ file: RoadbookFile; limitsError: string | null }> {
  const line: LatLon[] = [];
  const limits: RoadbookFile["limits"] = [];
  const legEndKm: number[] = [];
  const errors: string[] = [];
  let km = 0;

  for (const [i, routed] of input.shapes.entries()) {
    let points: LatLon[];
    let data: TraceAttributesResponse | null = null;
    try {
      data = await trace(routed);
      points = decodePolyline(data.shape ?? routed);
    } catch (e) {
      errors.push(`leg ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
      points = decodePolyline(routed);
    }
    // A leg starts where the last one ended: that point is written once.
    const last = line.at(-1);
    const duplicate = last !== undefined && points[0] !== undefined && haversineKm(last, points[0]) < 0.001;
    const base = duplicate ? line.length - 1 : line.length;
    line.push(...(duplicate ? points.slice(1) : points));

    if (data) {
      for (const edge of data.edges) {
        const from = edge.begin_shape_index;
        const to = edge.end_shape_index;
        if (from === undefined || to === undefined || to <= from) continue;
        const { kmh, posted } = effectiveLimit(edge, data.admins);
        const road = roadLabel(edge.names);
        const stretch = { from: base + from, to: base + to, kmh, posted, ...(road ? { road } : {}) };
        // Edges of one road under one limit are one stretch.
        const previous = limits.at(-1);
        if (
          previous &&
          previous.to === stretch.from &&
          previous.kmh === kmh &&
          previous.posted === posted &&
          previous.road === road
        ) {
          previous.to = stretch.to;
        } else limits.push(stretch);
      }
      km += data.edges.reduce((sum, e) => sum + e.length, 0);
    } else km += lengthKm(points);
    legEndKm.push(km);
  }

  // The loop's own stops, then the planned stops, in riding order by their place along the route.
  const loop = input.legs.flatMap((leg, i) => {
    const out: Array<{ km: number; lat: number; lon: number; name: string }> = [];
    if (i === 0) out.push({ km: 0, ...parseCoords(leg.fromCoords), name: `Start: ${leg.from}` });
    out.push({
      km: legEndKm[i] ?? km,
      ...parseCoords(leg.toCoords),
      name: i === input.legs.length - 1 ? `Finish: ${leg.to}` : `${i + 1}. ${leg.to}`,
    });
    return out;
  });
  const planned = (input.stops ?? []).map((s) => ({ km: s.km ?? 0, lat: s.lat, lon: s.lon, name: s.label }));
  const stops = [...loop, ...planned].sort((a, b) => a.km - b.km).map(({ lat, lon, name }) => ({ lat, lon, name }));

  const cameras = (input.cameras ?? []).map((c) => ({
    ...parseCoords(c.coords),
    kmh: cameraKmh(c.limitKmh),
    // A compass direction is the way the camera faces. forward and backward are relative to the OpenStreetMap
    // way, not to the route, so they are not exported; "both" is safe to state.
    bearing: cameraBearing(c.direction),
    direction: c.direction === "both" ? ("both" as const) : null,
  }));

  return {
    file: {
      format: ROADBOOK_FORMAT,
      version: ROADBOOK_VERSION,
      name: input.name,
      description: input.description,
      generatedAt: new Date().toISOString(),
      line: encodePolyline(line),
      stops,
      limits,
      cameras,
    },
    limitsError: errors.length ? `Speed limits missing for ${errors.join("; ")}` : null,
  };
}
