import type { PointFlow, TrafficProvider } from "./traffic.ts";
import { levelOf } from "./traffic.ts";

/**
 * Traffic from open government data (ADR 0042, spec traffic): the server reads the countries' public feeds of measured speeds and tells the
 * phone the same levels it would get from any provider. No key, no price per rider, and the feeds are read at most every few minutes
 * whatever the number of riders. Only the roads the feeds measure are covered; elsewhere a point is `unknown`.
 */

/** A feed is read again once it is this old, when a rider asks. */
export const FEED_MS = 5 * 60_000;
/** The reference list of stations changes slowly. */
const STATIONS_MS = 24 * 3_600_000;
/** A station answers for points this close to its section of road, metres. The phone's points are rounded to about a kilometre. */
export const MATCH_M = 1500;
/** Speeds kept per station to learn what it is when the road is free, and how many it takes before the figure is trusted. */
const KEEP = 288;
const MIN_SAMPLES = 12;

type Get = (url: string) => Promise<string>;

export interface OpenDataOptions {
  now?: () => number;
  /** For tests: the text at a URL. */
  get?: Get;
}

const defaultGet: Get = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "agentMotoride/0.1 (+https://github.com/bhoudebert/agent-motoride)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.text();
};

/** RGF93 / Lambert-93 (EPSG:2154) to WGS84 degrees: the French feeds give positions that way. */
export function lambert93ToWgs84(x: number, y: number): [number, number] {
  const a = 6378137;
  const e = 0.0818191910428158;
  const rad = Math.PI / 180;
  const [phi0, phi1, phi2, lambda0] = [46.5 * rad, 44 * rad, 49 * rad, 3 * rad];
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const n = (Math.log(m(phi1)) - Math.log(m(phi2))) / (Math.log(t(phi1)) - Math.log(t(phi2)));
  const F = m(phi1) / (n * t(phi1) ** n);
  const rho0 = a * F * t(phi0) ** n;
  const dx = x - 700000;
  const dy = rho0 - (y - 6600000);
  const rho = Math.hypot(dx, dy);
  const gamma = Math.atan2(dx, dy);
  const tt = (rho / (a * F)) ** (1 / n);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 8; i++) {
    phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2));
  }
  return [phi / rad, (gamma / n + lambda0) / rad];
}

/** A measured section of road: where it starts and ends. */
export interface Station {
  id: string;
  a: [number, number];
  b: [number, number];
}

/** The stations of the reference list that have a position; the others cannot be placed and are left out. */
export function parseStations(csv: string): Station[] {
  const out: Station[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const f = line.split(";");
    // The positions are the last five fields (start x and y, end x and y, then the city colour code).
    const [xa, ya, xb, yb] = f.slice(-5, -1).map(Number);
    if (f.length < 6 || ![xa, ya, xb, yb].every((n) => Number.isFinite(n) && n! > 0)) continue;
    out.push({ id: f[0]!, a: lambert93ToWgs84(xa!, ya!), b: lambert93ToWgs84(xb!, yb!) });
  }
  return out;
}

/** The average speed (km/h) of each station in a DATEX II "measured data" publication, and when it was made. */
export function parseSpeeds(xml: string): { time: string; speeds: Map<string, number> } {
  const time = /<publicationTime>([^<]+)<\/publicationTime>/.exec(xml)?.[1] ?? "";
  const speeds = new Map<string, number>();
  for (const block of xml.split("<siteMeasurements>").slice(1)) {
    const id = /MeasurementSiteRecord"\s+id="([^"]+)"/.exec(block)?.[1];
    const speed = /<averageVehicleSpeed[^>]*>\s*<speed>([\d.]+)<\/speed>/.exec(block)?.[1];
    // 9999999 is the feed's "no measure".
    if (id && speed && Number(speed) < 300) speeds.set(id, Number(speed));
  }
  return { time, speeds };
}

/** Metres from a point to a section of road, on a flat map (the sections are short). */
export function metresToSection(lat: number, lon: number, s: Station): number {
  const k = Math.cos((lat * Math.PI) / 180);
  const toXY = ([la, lo]: [number, number]) => [(lo - lon) * k * 111_320, (la - lat) * 110_540] as const;
  const [ax, ay] = toXY(s.a);
  const [bx, by] = toXY(s.b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + u * dx, ay + u * dy);
}

/** What each station's speed usually is on a free road, learnt from the speeds the feed has shown, as their 90th percentile. */
export class SpeedMemory {
  readonly #seen = new Map<string, number[]>();

  add(id: string, speed: number): void {
    const list = this.#seen.get(id) ?? [];
    list.push(speed);
    if (list.length > KEEP) list.shift();
    this.#seen.set(id, list);
  }

  /** The speed over the usual speed of an empty road, or null until enough has been seen to know it. */
  ratio(id: string, speed: number): number | null {
    const list = this.#seen.get(id);
    if (!list || list.length < MIN_SAMPLES) return null;
    const sorted = [...list].sort((p, q) => p - q);
    const reference = sorted[Math.floor(0.9 * (sorted.length - 1))]!;
    return reference > 0 ? Math.round(Math.min(1.2, speed / reference) * 100) / 100 : null;
  }
}

const UNKNOWN: PointFlow = { level: "unknown", ratio: null };

/** France: the speeds of the stations of the national roads outside the motorway concessions (transport.data.gouv.fr, Licence Ouverte 2.0). */
function france(get: Get, now: () => number) {
  const BASE = "https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/";
  let stations: Station[] = [];
  let stationsAt = -Infinity;
  let speeds = new Map<string, number>();
  let speedsAt = -Infinity;
  let published = "";
  const memory = new SpeedMemory();
  let loading: Promise<void> | null = null;

  const load = async () => {
    const t = now();
    if (t - stationsAt >= STATIONS_MS) {
      stations = parseStations(await get(`${BASE}refDir.csv`));
      stationsAt = t;
    }
    if (t - speedsAt >= FEED_MS) {
      const feed = parseSpeeds(await get(`${BASE}qtvDir.xml`));
      speeds = feed.speeds;
      speedsAt = t;
      // Each new publication adds one sample per station; a feed read again unchanged adds none.
      if (feed.time !== published) {
        published = feed.time;
        for (const [id, v] of speeds) memory.add(id, v);
      }
    }
  };

  return {
    country: "FR",
    covers: (lat: number, lon: number) => lat > 41 && lat < 51.5 && lon > -5.5 && lon < 10,
    async flowAt(lat: number, lon: number): Promise<PointFlow> {
      loading ??= load().finally(() => (loading = null));
      try {
        await loading;
      } catch {
        return UNKNOWN; // The feed is down: say nothing, and the next ask tries again.
      }
      let best: { s: Station; d: number } | null = null;
      for (const s of stations) {
        if (!speeds.has(s.id)) continue;
        const d = metresToSection(lat, lon, s);
        if (d <= MATCH_M && (!best || d < best.d)) best = { s, d };
      }
      if (!best) return UNKNOWN;
      const ratio = memory.ratio(best.s.id, speeds.get(best.s.id)!);
      return ratio === null ? UNKNOWN : { level: levelOf(ratio, false), ratio };
    },
  };
}

/** The open-data provider: the first country whose feed covers the point answers it. */
export function openData(options: OpenDataOptions = {}): TrafficProvider {
  const get = options.get ?? defaultGet;
  const now = options.now ?? Date.now;
  const sources = [france(get, now)];
  return {
    name: "open-data",
    countries: sources.map((s) => s.country),
    cacheMs: 0,
    metered: false,
    async flowAt(lat, lon) {
      const source = sources.find((s) => s.covers(lat, lon));
      return source ? source.flowAt(lat, lon) : UNKNOWN;
    },
  };
}
