import { decodePolyline, type LatLon } from "./geometry.ts";
import { haversineKm } from "./tools/geo.ts";

/** Google Maps takes about ten points per link on the phone. */
export const MAX_POINTS_PER_LINK = 10;
/** A pass-through point is worth adding when the road strays this far from the straight line. */
const MIN_DEVIATION_KM = 0.3;

export interface MapPoint extends LatLon {
  /** "waypoint" (a real stop), "via" (keeps the navigation on our road), "stop" (fuel, café...). */
  kind: "waypoint" | "via" | "stop";
  label?: string;
  /** Position along the whole route, for ordering. */
  km: number;
  /** For "via" points: how far the road strays from the straight line, km. Higher is more useful. */
  deviation?: number;
}

/** Distance from point p to the chord a-b, in km (flat-earth, fine at this scale). */
function deviationKm(p: LatLon, a: LatLon, b: LatLon): number {
  const kx = 111.32 * Math.cos((a.lat * Math.PI) / 180);
  const ax = 0,
    ay = 0;
  const bx = (b.lon - a.lon) * kx,
    by = (b.lat - a.lat) * 111.32;
  const px = (p.lon - a.lon) * kx,
    py = (p.lat - a.lat) * 111.32;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - (ax + t * bx),
    dy = py - (ay + t * by);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Candidate pass-through points for one leg: the points of the line farthest
 * from the straight chord, found recursively (Douglas-Peucker order), each with
 * its deviation. Those are the places where a fastest-path router would leave
 * the chosen road.
 */
function candidates(
  line: Array<LatLon & { km: number }>,
  from: number,
  to: number,
  out: Array<MapPoint & { deviation: number }>,
  depth: number,
): void {
  if (to - from < 2 || depth > 4) return;
  let bestIndex = -1;
  let best = 0;
  for (let i = from + 1; i < to; i++) {
    const d = deviationKm(line[i]!, line[from]!, line[to]!);
    if (d > best) {
      best = d;
      bestIndex = i;
    }
  }
  if (bestIndex < 0 || best < MIN_DEVIATION_KM) return;
  const p = line[bestIndex]!;
  out.push({ lat: p.lat, lon: p.lon, km: p.km, kind: "via", deviation: best });
  candidates(line, from, bestIndex, out, depth + 1);
  candidates(line, bestIndex, to, out, depth + 1);
}

/**
 * Points for the navigation link(s): the rider's waypoints, optional stops,
 * and as many pass-through points as the link budget allows, the most useful
 * first. Returns the ordered point list.
 */
export function navigationPoints(
  waypoints: Array<LatLon & { label?: string }>,
  shapes: string[],
  stops: Array<LatLon & { label: string; km: number }> = [],
  maxPoints = MAX_POINTS_PER_LINK,
): MapPoint[] {
  // Route line with cumulative km, split per leg.
  const legs: Array<Array<LatLon & { km: number }>> = [];
  let km = 0;
  for (const shape of shapes) {
    const decoded = decodePolyline(shape);
    const leg: Array<LatLon & { km: number }> = [];
    decoded.forEach((p, i) => {
      if (i > 0) km += haversineKm(decoded[i - 1]!, p);
      leg.push({ ...p, km });
    });
    legs.push(leg);
  }
  const fixed: MapPoint[] = waypoints.map((w, i) => ({
    lat: w.lat,
    lon: w.lon,
    kind: "waypoint",
    label: w.label,
    km: i === 0 ? 0 : (legs[i - 1]?.at(-1)?.km ?? 0),
  }));
  const stopPoints: MapPoint[] = stops.map((s) => ({ lat: s.lat, lon: s.lon, kind: "stop", label: s.label, km: s.km }));

  const vias: Array<MapPoint & { deviation: number }> = [];
  for (const leg of legs) candidates(leg, 0, leg.length - 1, vias, 0);
  vias.sort((a, b) => b.deviation - a.deviation);
  const budget = Math.max(0, maxPoints - fixed.length - stopPoints.length);
  const chosen: MapPoint[] = vias.slice(0, budget);

  return [...fixed, ...stopPoints, ...chosen].sort((a, b) => a.km - b.km || (a.kind === "waypoint" ? -1 : 1));
}

export interface MapsLink {
  url: string;
  /** Where this part begins and ends, for the rider to know when to switch. */
  from: MapPoint;
  to: MapPoint;
}

/**
 * Split an ordered point list into Google Maps links of at most `maxPoints`
 * each, consecutive links sharing their boundary point. The boundary is placed
 * at a planned stop when one lies within the link's reach, so the rider
 * switches links while already stopped; otherwise at a waypoint.
 */
export function splitLinks(points: MapPoint[], maxPoints = MAX_POINTS_PER_LINK): MapsLink[] {
  const links: MapsLink[] = [];
  let start = 0;
  while (start < points.length - 1) {
    const last = Math.min(start + maxPoints - 1, points.length - 1);
    let end = last;
    if (last < points.length - 1) {
      // Prefer a stop, then a waypoint, in the second half of the reach.
      const floor = start + Math.ceil((maxPoints - 1) / 2);
      for (const kind of ["stop", "waypoint"] as const) {
        for (let i = last; i >= floor; i--) {
          if (points[i]!.kind === kind) {
            end = i;
            break;
          }
        }
        if (end !== last || points[last]!.kind === kind) break;
      }
    }
    const chunk = points.slice(start, end + 1);
    links.push({
      url: `https://www.google.com/maps/dir/${chunk.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join("/")}`,
      from: chunk[0]!,
      to: chunk.at(-1)!,
    });
    start = end;
  }
  return links;
}

export function mapsLinks(points: MapPoint[], maxPoints = MAX_POINTS_PER_LINK): string[] {
  return splitLinks(points, maxPoints).map((l) => l.url);
}

/**
 * Navigation links for a ride: pass-through points keep Google on the chosen
 * roads, and the loop is split into several links when it needs more points
 * than one link takes.
 */
export function pinnedMapsLinks(
  waypoints: Array<LatLon & { label?: string }>,
  shapes: string[],
  stops: Array<LatLon & { label: string; km: number }> = [],
): string[] {
  return pinnedMapsParts(waypoints, shapes, stops).map((l) => l.url);
}

/** Same as pinnedMapsLinks, with where each part starts and ends. */
export function pinnedMapsParts(
  waypoints: Array<LatLon & { label?: string }>,
  shapes: string[],
  stops: Array<LatLon & { label: string; km: number }> = [],
): MapsLink[] {
  // Allow more points than one link holds, then split: a long loop gets two links rather than fewer pins.
  const total = Math.max(
    MAX_POINTS_PER_LINK,
    Math.ceil((shapes.length + stops.length + 6) / (MAX_POINTS_PER_LINK - 1)) * (MAX_POINTS_PER_LINK - 1) + 1,
  );
  let points = navigationPoints(waypoints, shapes, stops, Math.min(total, 2 * MAX_POINTS_PER_LINK - 1));
  // Splitting at stops can push a part over its budget and spawn a tiny extra
  // link; drop the least useful pass-through points until the loop fits the
  // number of parts its fixed points need.
  const fixedCount = points.filter((p) => p.kind !== "via").length;
  let targetParts = Math.max(1, Math.ceil((fixedCount - 1) / (MAX_POINTS_PER_LINK - 1)));
  // A long ride with a planned stop around its middle is better served by two
  // parts, each with its own pins, than by one link with few pins: the rider
  // switches links at the stop anyway.
  const totalKm = points.at(-1)?.km ?? 0;
  const midStop = points.some((p) => p.kind === "stop" && p.km > totalKm * 0.3 && p.km < totalKm * 0.7);
  if (targetParts === 1 && totalKm > 120 && midStop) targetParts = 2;
  let parts = splitLinks(points);
  while (parts.length > targetParts && points.some((p) => p.kind === "via")) {
    const weakest = points.filter((p) => p.kind === "via").sort((a, b) => (a.deviation ?? 0) - (b.deviation ?? 0))[0]!;
    points = points.filter((p) => p !== weakest);
    parts = splitLinks(points);
  }
  return parts;
}
