import { haversineKm } from "./tools/geo.ts";

export interface LatLon {
  lat: number;
  lon: number;
}

/** Decode a Valhalla encoded polyline (Google algorithm, 6 decimal places). */
export function decodePolyline(encoded: string, precision = 6): LatLon[] {
  const factor = 10 ** precision;
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / factor, lon: lon / factor });
  }
  return points;
}

/** Encode points as a polyline (precision 6), the inverse of decodePolyline. */
export function encodePolyline(points: LatLon[]): string {
  let out = "";
  let lastLat = 0;
  let lastLon = 0;
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e6);
    const lon = Math.round(p.lon * 1e6);
    encode(lat - lastLat);
    encode(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return out;
}

// Grid of roughly 500 m cells (exact at 45 degrees latitude; the same grid is
// used for every ride, so comparisons stay consistent anywhere).
const CELL_LAT = 0.0045;
const CELL_LON = 0.0064;
const cellOf = (p: LatLon) => `${Math.floor(p.lat / CELL_LAT)}:${Math.floor(p.lon / CELL_LON)}`;

/**
 * The set of grid cells a route passes through. Two routes on the same roads
 * give the same cells whatever the direction or the waypoints used.
 */
export function routeCells(shapes: string[]): string[] {
  const cells = new Set<string>();
  for (const shape of shapes) addCells(cells, decodePolyline(shape));
  return [...cells];
}

/** The grid cells a line of points passes through, e.g. a recorded track. */
export function pointCells(points: LatLon[]): string[] {
  const cells = new Set<string>();
  addCells(cells, points);
  return [...cells];
}

/** A cell set widened by one cell all round, to absorb GPS noise and the grid boundaries. */
export function widenCells(cells: Iterable<string>): Set<string> {
  const wide = new Set<string>();
  for (const cell of cells) {
    const [i = 0, j = 0] = cell.split(":").map(Number);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) wide.add(`${i + di}:${j + dj}`);
  }
  return wide;
}

/** The middle of a grid cell, back as a point. */
export function cellCenter(cell: string): LatLon {
  const [i = 0, j = 0] = cell.split(":").map(Number);
  return { lat: (i + 0.5) * CELL_LAT, lon: (j + 0.5) * CELL_LON };
}

/** The cell a point falls in. */
export const cellOfPoint = cellOf;

function addCells(cells: Set<string>, points: LatLon[]): void {
  for (let i = 0; i < points.length; i++) {
    const b = points[i]!;
    cells.add(cellOf(b));
    const a = points[i - 1];
    if (!a) continue;
    // Fill long straight segments so the cell trail has no gaps.
    const steps = Math.floor(haversineKm(a, b) / 0.2);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      cells.add(cellOf({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }));
    }
  }
}

/** Percent of the candidate route's cells already covered by another route. */
export function overlapPct(candidate: string[], other: Set<string>): number {
  if (candidate.length === 0) return 0;
  let shared = 0;
  for (const cell of candidate) if (other.has(cell)) shared++;
  return Math.round((shared / candidate.length) * 100);
}

export function centroid(points: LatLon[]): LatLon {
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), { lat: 0, lon: 0 });
  return { lat: sum.lat / points.length, lon: sum.lon / points.length };
}
