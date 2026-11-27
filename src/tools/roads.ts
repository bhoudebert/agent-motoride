import { fetchJson, HttpError } from "../http.ts";
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
  "unpaved",
  "gravel",
  "fine_gravel",
  "dirt",
  "earth",
  "ground",
  "grass",
  "sand",
  "mud",
  "compacted",
  "pebblestone",
]);

// The public servers limit concurrent requests per client; scouts running in
// parallel must take turns.
let overpassQueue: Promise<unknown> = Promise.resolve();

/** Hosts that refused us for good (401, 403: a mirror that is not open to us): not asked again by this process. */
const refusedHosts = new Set<string>();
/** After this many queries in a row that no instance answered, Overpass is left alone for a while. */
const BREAKER_AFTER = 2;
const BREAKER_FOR_MS = 60_000;
let failedInARow = 0;
let leftAloneUntil = 0;
let lastFailure = "";

/** How long one of the host's own instances has to answer before the public ones are asked. */
const OWN_TIMEOUT_MS = 20_000;
/** Own instances that did not answer, until when they are left alone. */
const ownDownUntil = new Map<string, number>();

/**
 * The host's own Overpass instances (`OVERPASS_URL`, docs/guide/self-hosting.md): one address or several separated by commas,
 * each an address of the query endpoint (the path `/api/interpreter` is added to an address that has none). Several are regions
 * of one map (Belgium and the north of France), not copies: a query goes to all of them and the answers are merged. Read at each
 * use, so a change of environment needs no restart. Empty: the public instances only.
 */
export function overpassUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const set = env.OVERPASS_URL?.trim();
  if (!set) return [];
  return set
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u !== "")
    .map((address) => {
      let url: URL;
      try {
        url = new URL(address);
      } catch {
        throw new Error(`OVERPASS_URL is not a URL: ${address}`);
      }
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error(`OVERPASS_URL must be http or https: ${address}`);
      if (url.pathname === "/") url.pathname = "/api/interpreter";
      return url.toString();
    });
}

/** Forget what was learnt about the instances (tests, and a long-lived server whose instances changed). */
export function resetOverpass(): void {
  ownDownUntil.clear();
  refusedHosts.clear();
  failedInARow = 0;
  leftAloneUntil = 0;
  lastFailure = "";
}

export interface OverpassOptions {
  /** Two attempts, no pauses; the caller has a cheaper fallback (a smaller query). */
  quick?: boolean;
  /** Epoch ms after which no attempt starts and none waits longer: the caller's answer is due. */
  deadline?: number;
}

export function overpass<T = OverpassElement>(query: string, options: OverpassOptions = {}): Promise<T[]> {
  const turn = overpassQueue.then(() => overpassNow(query, options)) as Promise<T[]>;
  overpassQueue = turn.catch(() => undefined);
  return turn;
}

/** One query to one instance. A remark means the query was cut short (timeout, memory): the result is partial or empty. */
async function askInstance(url: string, query: string, timeoutMs: number): Promise<OverpassElement[]> {
  const data = await fetchJson<{ elements: OverpassElement[]; remark?: string }>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    },
    timeoutMs,
  );
  if (data.remark) throw new RemarkError(`server remark: ${data.remark.slice(0, 80)}`);
  return data.elements;
}

class RemarkError extends Error {}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message.slice(0, 80) : String(error));

/**
 * The host's own instances, all of them: each knows its region only, so an answer missing from one would look like "nothing
 * there". The elements are merged by id. Null when any of them did not answer (it is named in `errors`): the public instances
 * are asked instead, and the one that failed is left alone for a minute (a query cut short by a remark does not count).
 */
async function askOwnInstances(
  urls: string[],
  query: string,
  errors: string[],
  left: () => number,
): Promise<OverpassElement[] | null> {
  const now = Date.now();
  const resting = urls.filter((u) => (ownDownUntil.get(u) ?? 0) > now);
  if (resting.length) {
    errors.push(`${resting.map((u) => new URL(u).host).join(", ")}: left alone after a failure`);
    return null;
  }
  if (left() < 2_000) return null;
  const answers = await Promise.allSettled(urls.map((u) => askInstance(u, query, Math.min(OWN_TIMEOUT_MS, left()))));
  const merged = new Map<string, OverpassElement>();
  let complete = true;
  answers.forEach((answer, i) => {
    if (answer.status === "fulfilled") {
      for (const e of answer.value) merged.set(`${e.type}/${e.id}`, e);
      return;
    }
    complete = false;
    if (!(answer.reason instanceof RemarkError)) ownDownUntil.set(urls[i]!, Date.now() + BREAKER_FOR_MS);
    errors.push(`${new URL(urls[i]!).host}: ${reasonOf(answer.reason)}`);
  });
  return complete ? [...merged.values()] : null;
}

async function overpassNow(query: string, options: OverpassOptions): Promise<OverpassElement[]> {
  const errors: string[] = [];
  const left = () => (options.deadline === undefined ? Infinity : options.deadline - Date.now());
  const own = overpassUrls();
  if (own.length) {
    const ours = await askOwnInstances(own, query, errors, left);
    if (ours) return ours;
  }
  const now = Date.now();
  if (now < leftAloneUntil) {
    throw new Error(
      `OpenStreetMap query service is unavailable (${[...errors, lastFailure].filter(Boolean).join("; ")}); not asked again for ${Math.ceil((leftAloneUntil - now) / 1000)} s. Retry later.`,
    );
  }
  // Quick mode: two attempts, no pauses; the caller has a cheaper fallback (a smaller query).
  const attempts = options.quick ? OVERPASS_ATTEMPTS.slice(0, 2).map((a) => ({ ...a, waitMs: 0 })) : OVERPASS_ATTEMPTS;
  for (const { url, timeoutMs, waitMs } of attempts) {
    const host = new URL(url).host;
    if (refusedHosts.has(host)) continue;
    if (left() < 2_000 + waitMs) {
      errors.push("time budget used");
      break;
    }
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      const elements = await askInstance(url, query, Math.min(timeoutMs, left()));
      failedInARow = 0;
      return elements;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) refusedHosts.add(host);
      errors.push(`${host}: ${reasonOf(error)}`);
    }
  }
  lastFailure = errors.join("; ");
  // A query cut short by its caller's deadline says nothing about the instances: only real failures count.
  if (!errors.includes("time budget used") && ++failedInARow >= BREAKER_AFTER)
    leftAloneUntil = Date.now() + BREAKER_FOR_MS;
  throw new Error(
    `OpenStreetMap query service is unavailable right now (${lastFailure}). Retry later or try a smaller radius.`,
  );
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
