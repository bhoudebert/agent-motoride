import { fetchJson } from "../http.ts";

export interface Point {
  lat: number;
  lon: number;
  label: string;
}

const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const cache = new Map<string, Point>();
const MAX_ADDRESS_DISTANCE_KM = 500;
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
    population?: number;
    country_code?: string;
    admin1?: string;
    admin2?: string;
  }>;
}

interface PhotonResponse {
  features: Array<{
    geometry: { coordinates: [number, number] };
    properties: {
      name?: string;
      street?: string;
      housenumber?: string;
      city?: string;
      state?: string;
      country?: string;
    };
  }>;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Towns and villages (Open-Meteo). Returns undefined when nothing fits the name and its qualifiers. */
async function geocodeTown(location: string): Promise<Point | undefined> {
  const [name = "", ...qualifiers] = location.split(",").map((part) => part.trim());
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "20");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const results = (await fetchJson<GeocodeResponse>(url.toString())).results ?? [];

  const wanted = qualifiers.map((q) => q.toLowerCase());
  // "Rue des Templiers, Lille": when the qualifiers match no town of that name,
  // the text is an address, not a town, and belongs to the street geocoder.
  const candidates =
    wanted.length === 0
      ? results
      : results.filter((r) => {
          const fields = [r.country, r.country_code, r.admin1, r.admin2]
            .filter((f): f is string => Boolean(f))
            .map((f) => f.toLowerCase());
          return wanted.every((q) => fields.includes(q));
        });
  const origin = anchor;
  // Near the start point wins, but a real town beats a namesake hamlet that is
  // only slightly closer: distance is discounted by the size of the place.
  const score = (r: (typeof results)[number]) =>
    origin ? haversineKm(origin, { lat: r.latitude, lon: r.longitude }) / Math.log10((r.population ?? 0) + 10) : 0;
  // Results arrive ranked by relevance; the stable sort keeps that order when there is no anchor.
  const best = [...candidates].sort((a, b) => score(a) - score(b))[0];
  return (
    best && {
      lat: best.latitude,
      lon: best.longitude,
      label: [best.name, best.admin1, best.country].filter(Boolean).join(", "),
    }
  );
}

/** Streets, addresses and places, tolerant of typos (Photon, OpenStreetMap data). */
async function geocodeAddress(location: string): Promise<Point | undefined> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", location);
  url.searchParams.set("limit", "1");
  if (anchor) {
    // Prefer matches near the rider's start point.
    url.searchParams.set("lat", String(anchor.lat));
    url.searchParams.set("lon", String(anchor.lon));
  }
  const feature = (await fetchJson<PhotonResponse>(url.toString(), {}, 15_000)).features[0];
  if (!feature) return undefined;
  const p = feature.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  return {
    lat: feature.geometry.coordinates[1],
    lon: feature.geometry.coordinates[0],
    label: [...new Set([p.name, street, p.city, p.country].filter(Boolean))].join(", "),
  };
}

/** Last resort: exact-match address search (Nominatim, OpenStreetMap). */
async function geocodeNominatim(location: string): Promise<Point | undefined> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", location);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const result = (await fetchJson<NominatimResult[]>(url.toString(), {}, 15_000))[0];
  return (
    result && {
      lat: Number(result.lat),
      lon: Number(result.lon),
      label: result.display_name
        .split(",")
        .slice(0, 3)
        .map((part) => part.trim())
        .join(", "),
    }
  );
}

/**
 * Resolve a location to coordinates. Accepts "lat,lon", a town
 * ("Florac", "Vannes, France") or a street or address
 * ("Avenue de Bretagne, Lille", "12 rue Nationale Lille").
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

  // Towns first (fast, clean labels), then streets and addresses. A geocoder
  // that is down must not hide a match from the next one.
  let point: Point | undefined;
  let tooFar: Point | undefined;
  for (const [geocode, fuzzy] of [
    [geocodeTown, false],
    [geocodeAddress, true],
    [geocodeNominatim, true],
  ] as const) {
    let found: Point | undefined;
    try {
      found = await geocode(location);
    } catch {
      continue;
    }
    if (!found) continue;
    // The address geocoders always answer something, even for a typo they
    // cannot place. A day ride does not have a waypoint a country away.
    if (fuzzy && anchor && haversineKm(anchor, found) > MAX_ADDRESS_DISTANCE_KM) {
      tooFar ??= found;
      continue;
    }
    point = found;
    break;
  }
  if (!point && tooFar) {
    throw new Error(
      `Place not found near the start point: "${location}". The closest text match is "${tooFar.label}", ${Math.round(haversineKm(anchor!, tooFar))} km away. Check the spelling or add the town ("street, town").`,
    );
  }
  if (!point) {
    throw new Error(
      `Place not found: "${location}". Check the spelling, add the town ("street, town"), or use "lat,lon".`,
    );
  }
  cache.set(key, point);
  return point;
}

interface ReverseResponse {
  features: Array<{
    properties: {
      name?: string;
      street?: string;
      locality?: string;
      district?: string;
      city?: string;
      osm_key?: string;
      osm_value?: string;
    };
  }>;
}

const reverseCache = new Map<string, string>();
/** Optional persistent cache, wired by the app to SQLite; place names do not change. */
let persistentCache: { get(key: string): string | undefined; set(key: string, value: string): void } | undefined;
export function usePersistentGeoCache(cache: typeof persistentCache): void {
  persistentCache = cache;
}

/**
 * A rider-readable name for a point given as coordinates: a pass or place name
 * when the point is one, otherwise the road and the nearest village,
 * e.g. "Col de Montmirat", "D 531 near Villard-de-Lans".
 */
export async function describeCoords(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = reverseCache.get(key) ?? persistentCache?.get(`reverse|${key}`);
  // Labels cached before postcodes were filtered out are not worth keeping.
  if (cached && !/^\d+$/.test(cached)) return cached;
  let label = key;
  try {
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("limit", "5");
    const features = (await fetchJson<ReverseResponse>(url.toString(), {}, 10_000)).features.map((f) => f.properties);
    // Roads, passes and settlements make good labels; postcodes, boundaries and bare numbers do not.
    type Props = ReverseResponse["features"][number]["properties"];
    const clean = (p: Props) => p.osm_value !== "postcode" && !/^\d+$/.test(p.name ?? "");
    const p =
      features.find((f) => clean(f) && (f.osm_key === "highway" || f.osm_key === "mountain_pass")) ??
      features.find((f) => clean(f) && f.osm_key === "place") ??
      features.find((f) => clean(f) && Boolean(f.street)) ??
      features[0];
    if (p) {
      const place = p.locality ?? p.district ?? p.city;
      const isRoad = p.osm_key === "highway";
      const name = p.name ?? p.street;
      if (name && isRoad) label = place && place !== name ? `${name} near ${place}` : name;
      else if (name) label = place && place !== name ? `${name}, ${place}` : name;
      else if (place) label = `near ${place}`;
    }
  } catch {
    // Keep the coordinates; a missing name must not fail a routing call.
  }
  reverseCache.set(key, label);
  persistentCache?.set(`reverse|${key}`, label);
  return label;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, in degrees [0, 360). */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const fmtCoords = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
