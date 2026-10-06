// Import a route shared as a GPX or KML file: read its line, reduce it to
// waypoints, route it like any planned loop, and add waypoints where the
// router strays from the file, so the result keeps to the file's roads.
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { type LatLon, overlapPct, pointCells, routeCells, widenCells } from "./geometry.ts";
import { haversineKm } from "./tools/geo.ts";
import type { CalculateTripInput, TripComputation } from "./tools/trip.ts";

export const MAX_ROUTE_FILE_BYTES = 10 * 1024 * 1024;
/** A loop when the file ends this close to where it starts. */
const LOOP_KM = 0.5;
const SPACING_KM = 15;
/** The public router takes 10 locations per route; a loop's return to the start is one of them. */
export const MAX_LOCATIONS = 10;
/** Start with fewer, to leave room for waypoints added where the router strays. */
const START_WAYPOINTS = 6;
const MAX_PASSES = 3;
/** A leg covering less of its stretch of the file than this gets another waypoint. */
const LEG_FIDELITY_PCT = 85;

export interface RouteFile {
  name: string | null;
  points: LatLon[];
  roundTrip: boolean;
  lengthKm: number;
}

const round1 = (n: number) => Number(n.toFixed(1));

function decodeXml(text: string): string {
  return text
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** The line of a GPX track or route, or of a KML LineString, with the file's name. */
export function parseRouteFile(text: string): RouteFile {
  let points: LatLon[] = [];
  if (/<kml[\s>]/i.test(text)) {
    for (const block of text.matchAll(/<LineString\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
      for (const tuple of block[1]!.trim().split(/\s+/)) {
        const [lon, lat] = tuple.split(",").map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon)) points.push({ lat: lat!, lon: lon! });
      }
    }
  } else {
    // A recorded track describes the ride best; a route's points are only its turns.
    for (const tag of ["trkpt", "rtept"]) {
      for (const m of text.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))) {
        const lat = Number(/\blat="([^"]+)"/.exec(m[1]!)?.[1]);
        const lon = Number(/\blon="([^"]+)"/.exec(m[1]!)?.[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) points.push({ lat, lon });
      }
      if (points.length) break;
    }
  }
  points = points.filter((p, i) => i === 0 || p.lat !== points[i - 1]!.lat || p.lon !== points[i - 1]!.lon);
  if (points.length < 2)
    throw new Error("No route line in this file: it needs a GPX track or route, or a KML LineString.");
  const name = /<name>([\s\S]*?)<\/name>/.exec(text)?.[1];
  const lengthKm = points.reduce((km, p, i) => (i ? km + haversineKm(points[i - 1]!, p) : 0), 0);
  return {
    name: name ? decodeXml(name) || null : null,
    points,
    roundTrip: points.length > 2 && haversineKm(points[0]!, points.at(-1)!) <= LOOP_KM,
    lengthKm: round1(lengthKm),
  };
}

/** Read a route file from this machine: .gpx or .kml, 10 MB at most. */
export function readRouteFile(path: string): RouteFile {
  const ext = extname(path).toLowerCase();
  if (ext !== ".gpx" && ext !== ".kml") throw new Error(`${basename(path)}: only .gpx and .kml route files are read.`);
  if (statSync(path).size > MAX_ROUTE_FILE_BYTES) throw new Error(`${basename(path)} is over 10 MB.`);
  return parseRouteFile(readFileSync(path, "utf8"));
}

/** Distance along the line at each point. */
function along(points: LatLon[]): number[] {
  const km = [0];
  for (let i = 1; i < points.length; i++) km.push(km[i - 1]! + haversineKm(points[i - 1]!, points[i]!));
  return km;
}

/** Indices of the starting waypoints: one about every 15 km, at most 6, the end too unless it is a loop. */
function startingWaypoints(km: number[], roundTrip: boolean): number[] {
  const last = km.length - 1;
  const total = km[last]!;
  const slots = roundTrip ? START_WAYPOINTS : START_WAYPOINTS - 1;
  const spacing = Math.max(SPACING_KM, total / slots);
  const picked = [0];
  for (let i = 1; i < last; i++) if (km[i]! >= picked.length * spacing && total - km[i]! > spacing / 3) picked.push(i);
  // A loop needs at least two waypoints besides the start to be routed as a loop.
  while (roundTrip && picked.length < 3) {
    const at = km.findIndex((d) => d >= (total * picked.length) / 3);
    if (at <= picked.at(-1)! || at >= last) break;
    picked.push(at);
  }
  if (!roundTrip) picked.push(last);
  return picked;
}

const coords = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/** Share of a stretch of the file that a routed line covers, with one grid cell of tolerance. */
function coverage(stretch: LatLon[], shapes: string[]): number {
  return overlapPct(pointCells(stretch), widenCells(routeCells(shapes)));
}

export interface ImportResult {
  trip: TripComputation;
  waypoints: string[];
  roundTrip: boolean;
  /** Share of the file's line covered by the routed trip. */
  fidelityPct: number;
  /** Routing calls made, one per pass. */
  passes: number;
  /** Legs still under the per-leg threshold, by number, with their coverage. */
  weakLegs: Array<{ leg: number; coveragePct: number }>;
}

/**
 * Route a file's line through waypoints taken from it, adding a waypoint in
 * the middle of every stretch the router does not follow, until the legs keep
 * to the file or the limits on passes and waypoints are reached.
 */
export async function importRoute(
  file: RouteFile,
  options: { avoidMotorways: boolean; route: (input: CalculateTripInput) => Promise<TripComputation> },
): Promise<ImportResult> {
  const { points, roundTrip } = file;
  const km = along(points);
  let picked = startingWaypoints(km, roundTrip);
  let passes = 0;
  for (;;) {
    passes++;
    const waypoints = picked.map((i) => coords(points[i]!));
    const trip = await options.route({ waypoints, roundTrip, avoidMotorways: options.avoidMotorways });
    // Leg j replaces the file from waypoint j to the next one (the start again, for a loop's last leg).
    const ends = roundTrip ? [...picked, points.length - 1] : picked;
    const legs = ends.slice(0, -1).map((from, j) => {
      const to = ends[j + 1]!;
      return { from, to, coveragePct: coverage(points.slice(from, to + 1), [trip.shapes[j] ?? ""]) };
    });
    const weak = legs.filter((l) => l.coveragePct < LEG_FIDELITY_PCT && l.to - l.from >= 2);
    const result = {
      trip,
      waypoints,
      roundTrip,
      fidelityPct: coverage(points, trip.shapes),
      passes,
      weakLegs: legs.flatMap((l, j) =>
        l.coveragePct < LEG_FIDELITY_PCT ? [{ leg: j + 1, coveragePct: l.coveragePct }] : [],
      ),
    };
    const maxWaypoints = roundTrip ? MAX_LOCATIONS - 1 : MAX_LOCATIONS;
    if (!weak.length || passes >= MAX_PASSES || picked.length >= maxWaypoints) return result;
    // A waypoint halfway along each stretch the router left, worst first, within the cap.
    const room = maxWaypoints - picked.length;
    const added = weak
      .sort((a, b) => a.coveragePct - b.coveragePct)
      .slice(0, room)
      .map((l) => {
        const middle = (km[l.from]! + km[l.to]!) / 2;
        return km.findIndex((d, i) => i > l.from && d >= middle);
      })
      .filter((i) => i > 0 && i < points.length - 1);
    picked = [...new Set([...picked, ...added])].sort((a, b) => a - b);
  }
}
