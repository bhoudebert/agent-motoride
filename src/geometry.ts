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
  for (const shape of shapes) {
    const points = decodePolyline(shape);
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
  return [...cells];
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
