import type { LatLon } from "./geometry.ts";
import { haversineKm } from "./tools/geo.ts";
import { overpass } from "./tools/roads.ts";

/** A way of telling whether a point lies in built-up land. */
export type InBuiltUp = (point: LatLon) => boolean;
/** Prepares the built-up land around a line of points; may throw when the map service is down. */
export type BuiltUpLookup = (points: LatLon[]) => Promise<InBuiltUp>;

type Polygon = { ring: LatLon[]; box: [number, number, number, number] };

/** Land use that a rider crosses at town speed. Multipolygon relations are not read: a few large areas are missed. */
const LANDUSE = "residential|commercial|retail|industrial";
const CELL_DEGREES = 0.1;
const MAX_CELLS = 120;
/** At least this share of an edge inside built-up land makes it a built-up edge. */
export const BUILT_UP_SHARE = 0.5;
/** Spacing of the samples taken along an edge, km. */
const SAMPLE_KM = 0.04;

const cells = new Map<string, Promise<Polygon[]>>();

function boxOf(ring: LatLon[]): Polygon["box"] {
  let s = 90,
    w = 180,
    n = -90,
    e = -180;
  for (const p of ring) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
  }
  return [s, w, n, e];
}

/** Ray casting: whether the point lies inside the ring. */
export function insideRing(point: LatLon, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a.lon > point.lon !== b.lon > point.lon &&
      point.lat < ((b.lat - a.lat) * (point.lon - a.lon)) / (b.lon - a.lon) + a.lat
    )
      inside = !inside;
  }
  return inside;
}

/** A point lookup over the given rings (exported for tests). */
export function builtUpFrom(rings: LatLon[][]): InBuiltUp {
  const polygons: Polygon[] = rings.filter((r) => r.length >= 4).map((ring) => ({ ring, box: boxOf(ring) }));
  return (p) =>
    polygons.some(
      ({ ring, box }) =>
        p.lat >= box[0] && p.lat <= box[2] && p.lon >= box[1] && p.lon <= box[3] && insideRing(p, ring),
    );
}

/**
 * The share (0 to 1) of the stretch of `points` from index `from` to `to` that lies in built-up land, sampled about
 * every 40 m along it.
 */
export function builtUpShare(points: LatLon[], from: number, to: number, inBuiltUp: InBuiltUp): number {
  let samples = 0;
  let inside = 0;
  for (let i = Math.max(from, 0); i < to && i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const steps = Math.max(1, Math.round(haversineKm(a, b) / SAMPLE_KM));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      samples++;
      if (inBuiltUp({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t })) inside++;
    }
  }
  return samples ? inside / samples : 0;
}

/** The built-up land of one 0.1 degree cell of the map, kept for the life of the process. */
function cellPolygons(i: number, j: number): Promise<Polygon[]> {
  const key = `${i},${j}`;
  let cell = cells.get(key);
  if (!cell) {
    const s = i * CELL_DEGREES;
    const w = j * CELL_DEGREES;
    const bbox = [s, w, s + CELL_DEGREES, w + CELL_DEGREES].map((n) => n.toFixed(4)).join(",");
    cell = overpass<{ geometry?: Array<{ lat: number; lon: number } | null> }>(
      `[out:json][timeout:60];way["landuse"~"^(${LANDUSE})$"](${bbox});out geom;`,
    ).then((elements) =>
      elements.flatMap((el) => {
        const ring = (el.geometry ?? []).filter((p): p is LatLon => p !== null);
        return ring.length >= 4 ? [{ ring, box: boxOf(ring) }] : [];
      }),
    );
    // A failed cell is not kept: the next export asks again.
    cell.catch(() => cells.delete(key));
    cells.set(key, cell);
    while (cells.size > MAX_CELLS) cells.delete(cells.keys().next().value!);
  }
  return cell;
}

/**
 * Built-up land from OpenStreetMap's land use, for the map cells a line crosses (one slow query each, cached). A query
 * for a cell returns every way that touches it, so land across the edge of a cell is not lost.
 */
export const overpassBuiltUp: BuiltUpLookup = async (points) => {
  const wanted = new Set<string>();
  for (const p of points) wanted.add(`${Math.floor(p.lat / CELL_DEGREES)},${Math.floor(p.lon / CELL_DEGREES)}`);
  const lists = await Promise.all(
    [...wanted].map((key) => {
      const [i, j] = key.split(",").map(Number) as [number, number];
      return cellPolygons(i, j);
    }),
  );
  return builtUpFrom(lists.flat().map((p) => p.ring));
};
