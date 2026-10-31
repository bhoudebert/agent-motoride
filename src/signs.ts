import type { LatLon } from "./geometry.ts";
import { fetchJson } from "./http.ts";
import { bearingDeg } from "./tools/geo.ts";

/** A speed limit sign seen in street-level photos, with the way it faces (degrees) when that is known. */
export type Sign = LatLon & { kmh: number; seenAt: number; facing: number | null };
/** The limit that signs give a stretch of line (point indexes `from` to `to`), or null when no clear sign stands there. */
export type SignLimit = (points: LatLon[], from: number, to: number) => number | null;
/** Prepares the signs around a line of points; may throw when the sign service is down. */
export type SignLookup = (points: LatLon[]) => Promise<SignLimit>;

const API = "https://graph.mapillary.com";
/** The API refuses a box of 0.01 square degrees or more. */
const CELL_DEGREES = 0.05;
const MAX_CELLS = 200;
/** Sign kinds read: limits, and the road works markers that say a limit is temporary. */
const OBJECT_VALUES = "regulatory--maximum-speed-limit*,warning--roadworks*,information--end-of-road-works*";
/** A sign counts for a stretch when it stands this close to it, metres: roadside signs measure 3 to 10 m, side roads 15 and more. */
export const SIGN_REACH_M = 12;
/** A road works marker this close to a limit sign makes the limit temporary, metres. */
export const WORKS_REACH_M = 40;
/** A sign faces along the road, either way, within this angle of the road's axis. Across it is a side road. */
export const AXIS_TOLERANCE_DEG = 35;
/** A sign not seen for this long is not trusted: it may be gone or replaced. */
export const MAX_AGE_MS = 2 * 365 * 24 * 3600 * 1000;
/** Requests for a sign's facing run this many at a time. */
const FACING_PARALLEL = 4;

type Raw = { id: string; value: string; lat: number; lon: number; seenAt: number };
type Cell = { limits: Raw[]; works: LatLon[] };

const cells = new Map<string, Promise<Cell>>();
const facings = new Map<string, Promise<number | null>>();

/** The token of the sign service: without one the sign check is off and the roadbook is what it was without it. */
export function signsToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env.MAPILLARY_ACCESS_TOKEN?.trim();
  return token ? token : null;
}

/** "regulatory--maximum-speed-limit-50--g1" gives 50; anything else (end of limit, minimum limit, 15 zone) gives null. */
export function kmhOfSign(objectValue: string): number | null {
  const m = /^regulatory--maximum-speed-limit-(\d{2,3})--/.exec(objectValue);
  if (!m) return null;
  const kmh = Number(m[1]);
  return kmh >= 20 && kmh <= 130 && kmh % 10 === 0 ? kmh : null;
}

/** Distance in metres from a point to the segment a-b, on a plane flattened around the point (good over a few hundred m). */
export function metresToSegment(p: LatLon, a: LatLon, b: LatLon): number {
  const kLat = 111_320;
  const kLon = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lon - p.lon) * kLon;
  const ay = (a.lat - p.lat) * kLat;
  const bx = (b.lon - p.lon) * kLon;
  const by = (b.lat - p.lat) * kLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** The angle between two directions as lines, 0 to 90: a sign facing a road's way or the other way is 0, across it 90. */
export function axisAngle(a: number, b: number): number {
  const d = (((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
}

/**
 * A lookup over the given signs. A sign belongs to the segment of the line nearest to it, within reach, and only when
 * it faces along that segment (either way: a limit holds both ways), was seen recently and is not next to road works
 * markers (`works`). A stretch takes the limit of its signs when they agree; two different limits mean none.
 * Exported for tests.
 */
export function signLimitFrom(signs: Sign[], works: LatLon[], now = Date.now()): SignLimit {
  const usable = signs.filter(
    (s) =>
      s.facing !== null &&
      now - s.seenAt <= MAX_AGE_MS &&
      !works.some((w) => metresToSegment(w, s, s) <= WORKS_REACH_M),
  );
  return (points, from, to) => {
    const found = new Set<number>();
    for (const sign of usable) {
      let nearest = -1;
      let best = Infinity;
      for (let i = 0; i + 1 < points.length; i++) {
        const d = metresToSegment(sign, points[i]!, points[i + 1]!);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
      if (nearest < from || nearest >= to || best > SIGN_REACH_M) continue;
      if (axisAngle(sign.facing!, bearingDeg(points[nearest]!, points[nearest + 1]!)) <= AXIS_TOLERANCE_DEG)
        found.add(sign.kmh);
    }
    return found.size === 1 ? [...found][0]! : null;
  };
}

type Feature = {
  id?: string;
  object_value?: string;
  last_seen_at?: string;
  geometry?: { coordinates?: [number, number] };
};

function cellOf(i: number, j: number, token: string): Promise<Cell> {
  const key = `${i},${j}`;
  let cell = cells.get(key);
  if (!cell) {
    const s = i * CELL_DEGREES;
    const w = j * CELL_DEGREES;
    const bbox = [w, s, w + CELL_DEGREES, s + CELL_DEGREES].map((n) => n.toFixed(4)).join(",");
    const url =
      `${API}/map_features?access_token=${encodeURIComponent(token)}&fields=id,object_value,geometry,last_seen_at` +
      `&object_values=${encodeURIComponent(OBJECT_VALUES)}&limit=2000&bbox=${bbox}`;
    cell = fetchJson<{ data?: Feature[] }>(url).then((body) => {
      const out: Cell = { limits: [], works: [] };
      for (const f of body.data ?? []) {
        const c = f.geometry?.coordinates;
        if (!c) continue;
        const value = f.object_value ?? "";
        if (kmhOfSign(value) !== null && f.id)
          out.limits.push({ id: f.id, value, lat: c[1], lon: c[0], seenAt: Date.parse(f.last_seen_at ?? "") || 0 });
        else if (/^(warning--roadworks|information--end-of-road-works)/.test(value))
          out.works.push({ lat: c[1], lon: c[0] });
      }
      return out;
    });
    // A failed cell is not kept: the next export asks again.
    cell.catch(() => cells.delete(key));
    cells.set(key, cell);
    while (cells.size > MAX_CELLS) cells.delete(cells.keys().next().value!);
  }
  return cell;
}

/** The way a sign faces, in degrees; the search does not give it, so it is one request per sign, kept. Null when unknown. */
function facingOf(id: string, token: string): Promise<number | null> {
  let facing = facings.get(id);
  if (!facing) {
    facing = fetchJson<{ aligned_direction?: number }>(
      `${API}/${encodeURIComponent(id)}?access_token=${encodeURIComponent(token)}&fields=aligned_direction`,
    )
      .then((body) => (typeof body.aligned_direction === "number" ? body.aligned_direction : null))
      .catch(() => {
        // Not kept: the next export asks again.
        facings.delete(id);
        return null;
      });
    facings.set(id, facing);
    while (facings.size > 5000) facings.delete(facings.keys().next().value!);
  }
  return facing;
}

/** Speed limit signs from Mapillary's street-level imagery, for the map cells a line crosses (one request each, cached). */
export function mapillarySigns(token: string): SignLookup {
  return async (points) => {
    const wanted = new Set<string>();
    for (const p of points) wanted.add(`${Math.floor(p.lat / CELL_DEGREES)},${Math.floor(p.lon / CELL_DEGREES)}`);
    const lists = await Promise.all(
      [...wanted].map((key) => {
        const [i, j] = key.split(",").map(Number) as [number, number];
        return cellOf(i, j, token);
      }),
    );
    const works = lists.flatMap((c) => c.works);
    // Only the signs by the line need their facing: a few dozen a ride, not the hundreds in the cells.
    const near = lists
      .flatMap((c) => c.limits)
      .filter((raw) => {
        for (let i = 0; i + 1 < points.length; i++)
          if (metresToSegment(raw, points[i]!, points[i + 1]!) <= SIGN_REACH_M) return true;
        return false;
      });
    const signs: Sign[] = [];
    for (let k = 0; k < near.length; k += FACING_PARALLEL) {
      const batch = near.slice(k, k + FACING_PARALLEL);
      const facing = await Promise.all(batch.map((raw) => facingOf(raw.id, token)));
      batch.forEach((raw, n) =>
        signs.push({ lat: raw.lat, lon: raw.lon, kmh: kmhOfSign(raw.value)!, seenAt: raw.seenAt, facing: facing[n]! }),
      );
    }
    return signLimitFrom(signs, works);
  };
}

/** The sign lookup when a token is set, else undefined. Read at each use, like the other settings. */
export function configuredSigns(env: NodeJS.ProcessEnv = process.env): SignLookup | undefined {
  const token = signsToken(env);
  return token ? mapillarySigns(token) : undefined;
}
