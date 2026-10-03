import { fetchJson } from "../http.ts";
import { bearingDeg, fmtCoords, haversineKm, resolvePoint } from "./geo.ts";

export interface SearchRoadsInput {
  location: string;
  radiusKm?: number;
  minLengthKm?: number;
  limit?: number;
}

interface OverpassElement {
  type: "way" | "node";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

// Public Overpass servers shed load with 429/504 and vary a lot in latency,
// so alternate between the main server and mirrors, pausing before each retry.
const OVERPASS_ATTEMPTS: Array<{ url: string; timeoutMs: number; waitMs: number }> = [
  { url: "https://overpass-api.de/api/interpreter", timeoutMs: 45_000, waitMs: 0 },
  // Worldwide instance run by OSM France; usually the quickest to answer.
  { url: "https://overpass.openstreetmap.fr/api/interpreter", timeoutMs: 45_000, waitMs: 0 },
  // Second entry point of the main service.
  { url: "https://z.overpass-api.de/api/interpreter", timeoutMs: 45_000, waitMs: 2_000 },
  { url: "https://overpass.openstreetmap.fr/api/interpreter", timeoutMs: 45_000, waitMs: 5_000 },
  { url: "https://overpass-api.de/api/interpreter", timeoutMs: 45_000, waitMs: 8_000 },
];

const UNPAVED = new Set([
  "unpaved", "gravel", "fine_gravel", "dirt", "earth", "ground", "grass", "sand", "mud", "compacted", "pebblestone",
]);

// The public servers limit concurrent requests per client; scouts running in
// parallel must take turns.
let overpassQueue: Promise<unknown> = Promise.resolve();

export function overpass<T = OverpassElement>(query: string, options: { quick?: boolean } = {}): Promise<T[]> {
  const turn = overpassQueue.then(() => overpassNow(query, options)) as Promise<T[]>;
  overpassQueue = turn.catch(() => undefined);
  return turn;
}

async function overpassNow(query: string, options: { quick?: boolean }): Promise<OverpassElement[]> {
  const errors: string[] = [];
  // Quick mode: two attempts, no pauses; the caller has a cheaper fallback (a smaller query).
  const attempts = options.quick ? OVERPASS_ATTEMPTS.slice(0, 2).map((a) => ({ ...a, waitMs: 0 })) : OVERPASS_ATTEMPTS;
  for (const { url, timeoutMs, waitMs } of attempts) {
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      const data = await fetchJson<{ elements: OverpassElement[]; remark?: string }>(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
        },
        timeoutMs,
      );
      // A remark means the query was cut short (timeout, memory); the result is partial or empty.
      if (data.remark) throw new Error(`server remark: ${data.remark.slice(0, 80)}`);
      return data.elements;
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 80) : String(error);
      errors.push(`${new URL(url).host}: ${reason}`);
    }
  }
  throw new Error(`OpenStreetMap query service is unavailable right now (${errors.join("; ")}). Retry later or try a smaller radius.`);
}

interface RoadGroup {
  ref: string;
  names: Set<string>;
  classes: Set<string>;
  lengthKm: number;
  turningDeg: number;
  endpoints: Array<{ lat: number; lon: number }>;
}

/**
 * Find winding secondary/tertiary roads and mountain passes around a place,
 * from OpenStreetMap. Curviness = cumulative heading change per km. Measured:
 * the best roads of a flat plain score 170-290, Cevennes mountain roads 460-640.
 */
export async function searchRoads(input: SearchRoadsInput) {
  const radiusKm = Math.min(Math.max(input.radiusKm ?? 25, 5), 40);
  const minLengthKm = input.minLengthKm ?? 5;
  const limit = Math.min(input.limit ?? 12, 25);
  const center = await resolvePoint(input.location);
  // A bounding box is far cheaper for Overpass than an "around" radius filter.
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  const bbox = [center.lat - dLat, center.lon - dLon, center.lat + dLat, center.lon + dLon]
    .map((n) => n.toFixed(4))
    .join(",");

  const elements = await overpass(`
    [out:json][timeout:40][bbox:${bbox}];
    (
      way["highway"~"^(secondary|tertiary)$"]["ref"];
      node["mountain_pass"="yes"]["name"];
    );
    out geom qt;`);

  const groups = new Map<string, RoadGroup>();
  const passes: Array<{ name: string; elevationM: number | null; coords: string }> = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
      const ele = Number.parseFloat(tags.ele ?? "");
      passes.push({
        name: tags.name!,
        elevationM: Number.isFinite(ele) ? Math.round(ele) : null,
        coords: fmtCoords({ lat: el.lat, lon: el.lon }),
      });
      continue;
    }
    const geometry = el.geometry;
    if (el.type !== "way" || !geometry || geometry.length < 2) continue;
    if (tags.surface && UNPAVED.has(tags.surface)) continue;

    const ref = tags.ref!.split(";")[0]!.replace(/\s+/g, " ").trim();
    let group = groups.get(ref);
    if (!group) {
      group = { ref, names: new Set(), classes: new Set(), lengthKm: 0, turningDeg: 0, endpoints: [] };
      groups.set(ref, group);
    }
    if (tags.name) group.names.add(tags.name);
    group.classes.add(tags.highway!);
    group.endpoints.push(geometry[0]!, geometry.at(-1)!);

    let previousBearing: number | null = null;
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1]!;
      const b = geometry[i]!;
      const segmentKm = haversineKm(a, b);
      if (segmentKm === 0) continue;
      group.lengthKm += segmentKm;
      const bearing = bearingDeg(a, b);
      if (previousBearing !== null) {
        const delta = Math.abs(bearing - previousBearing);
        group.turningDeg += Math.min(delta, 360 - delta);
      }
      previousBearing = bearing;
    }
  }

  const candidates = [...groups.values()].filter((g) => g.lengthKm >= minLengthKm);
  const scores = candidates.map((g) => g.turningDeg / g.lengthKm).sort((a, b) => a - b);
  const roads = candidates
    .map((g) => {
      // The two endpoints furthest apart approximate the ends of the stretch.
      let from = g.endpoints[0]!;
      let to = g.endpoints[1]!;
      let best = 0;
      for (const a of g.endpoints) {
        for (const b of g.endpoints) {
          const d = haversineKm(a, b);
          if (d > best) [best, from, to] = [d, a, b];
        }
      }
      return {
        ref: g.ref,
        names: [...g.names].slice(0, 3),
        roadClass: [...g.classes].join("/"),
        lengthKm: Number(g.lengthKm.toFixed(1)),
        curvinessDegPerKm: Math.round(g.turningDeg / g.lengthKm),
        from: fmtCoords(from),
        to: fmtCoords(to),
      };
    })
    .sort((a, b) => b.curvinessDegPerKm - a.curvinessDegPerKm)
    .slice(0, limit);

  passes.sort((a, b) => (b.elevationM ?? 0) - (a.elevationM ?? 0));
  return {
    center: center.label,
    radiusKm,
    roadsConsidered: candidates.length,
    areaMedianCurviness: Math.round(scores[Math.floor(scores.length / 2)] ?? 0),
    roads,
    mountainPasses: passes.slice(0, 15),
  };
}
