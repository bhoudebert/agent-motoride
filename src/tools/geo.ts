import { fetchJson } from "../http.ts";

export interface Point {
  lat: number;
  lon: number;
  label: string;
}

const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const cache = new Map<string, Point>();
let anchor: { lat: number; lon: number } | undefined;

/**
 * Bias ambiguous place names toward this location. Many names exist in several
 * countries ("Die", "Mens"); the one nearest the rider's start is the one meant.
 */
export async function setGeoAnchor(location: string): Promise<Point> {
  anchor = undefined;
  cache.clear();
  const point = await resolvePoint(location);
  anchor = point;
  return point;
}

interface GeocodeResponse {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    admin2?: string;
  }>;
}

/**
 * Resolve a location to coordinates. Accepts "lat,lon" or a place name,
 * optionally qualified: "Vannes, France", "Florac, Lozère".
 */
export async function resolvePoint(location: string): Promise<Point> {
  const coords = COORDS.exec(location);
  if (coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error(`Coordinates out of range: "${location}" (expected "lat,lon")`);
    }
    return { lat, lon, label: `${lat},${lon}` };
  }

  const key = location.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const [name = "", ...qualifiers] = location.split(",").map((s) => s.trim());
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "20");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const data = await fetchJson<GeocodeResponse>(url.toString());
  const results = data.results ?? [];
  if (results.length === 0) {
    throw new Error(`Place not found: "${location}". Try a nearby town name or "lat,lon".`);
  }

  const wanted = qualifiers.map((q) => q.toLowerCase());
  const qualified = results.filter((r) => {
    const fields = [r.country, r.country_code, r.admin1, r.admin2]
      .filter((f): f is string => Boolean(f))
      .map((f) => f.toLowerCase());
    return wanted.length > 0 && wanted.every((q) => fields.includes(q));
  });
  const candidates = qualified.length > 0 ? qualified : results;
  const origin = anchor;
  const distanceTo = (r: (typeof results)[number]) =>
    origin ? haversineKm(origin, { lat: r.latitude, lon: r.longitude }) : 0;
  // Results arrive ranked by relevance; the stable sort keeps that order when there is no anchor.
  const best = [...candidates].sort((a, b) => distanceTo(a) - distanceTo(b))[0]!;

  const point: Point = {
    lat: best.latitude,
    lon: best.longitude,
    label: [best.name, best.admin1, best.country].filter(Boolean).join(", "),
  };
  cache.set(key, point);
  return point;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, in degrees [0, 360). */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const fmtCoords = (p: { lat: number; lon: number }) =>
  `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
