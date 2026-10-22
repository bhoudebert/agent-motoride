import { fetchJson } from "./http.ts";

/**
 * Traffic flow for the phone (ADR 0030, spec traffic): the server asks TomTom for the flow at a few points of the road ahead,
 * with its own key, and tells the phone how fast the traffic goes there compared with an empty road. The phone never holds a
 * key and never talks to TomTom; the host answers for their own key and quota.
 */
export type TrafficLevel = "free" | "slow" | "heavy" | "closed" | "unknown";

export interface TrafficPoint {
  lat: number;
  lon: number;
  level: TrafficLevel;
  /** Current speed over the speed of an empty road, 0 to 1 or a little more; null when unknown. */
  ratio: number | null;
}

/** The part of TomTom's Flow Segment Data answer that is used. */
interface FlowSegment {
  flowSegmentData?: {
    currentSpeed?: number;
    freeFlowSpeed?: number;
    confidence?: number;
    roadClosure?: boolean;
  };
}

/** A point is about a kilometre wide: the same cell is asked once for every rider in the cache time. */
const cell = (n: number) => n.toFixed(2);
export const MAX_POINTS = 8;
/** Answers kept five minutes, which is how fast TomTom's flow changes and how often a phone asks. */
export const CACHE_MS = 5 * 60_000;
/** Below this confidence TomTom's figure is mostly historical: say nothing rather than guess. */
const MIN_CONFIDENCE = 0.5;

/** What a ratio of current to free-flow speed means for a rider. */
export function levelOf(ratio: number | null, closed: boolean): TrafficLevel {
  if (closed) return "closed";
  if (ratio === null) return "unknown";
  if (ratio >= 0.8) return "free";
  if (ratio >= 0.5) return "slow";
  return "heavy";
}

export interface TrafficOptions {
  /** TomTom key, empty for none; without one the server offers no traffic. Default `TOMTOM_API_KEY`. */
  key?: string;
  /** TomTom requests a day, so a host's quota cannot be used up by their riders (default 600). */
  perDay?: number;
  now?: () => number;
  fetch?: (url: string) => Promise<FlowSegment>;
}

export class TrafficFlow {
  readonly #key: string | undefined;
  readonly #perDay: number;
  readonly #now: () => number;
  readonly #fetch: (url: string) => Promise<FlowSegment>;
  readonly #cache = new Map<string, { at: number; point: Omit<TrafficPoint, "lat" | "lon"> }>();
  #day = "";
  #used = 0;

  constructor(options: TrafficOptions = {}) {
    this.#key = (options.key ?? process.env.TOMTOM_API_KEY) || undefined;
    this.#perDay = options.perDay ?? (Number(process.env.TRAFFIC_MAX_PER_DAY) || 600);
    this.#now = options.now ?? Date.now;
    this.#fetch = options.fetch ?? ((url) => fetchJson<FlowSegment>(url, {}, 8000));
  }

  /** Whether this server has a key, and so offers traffic. */
  get available(): boolean {
    return this.#key !== undefined;
  }

  /** Flow at each point, from the cache or from TomTom; a point TomTom could not answer is `unknown`. */
  async flow(points: Array<[number, number]>): Promise<{ points: TrafficPoint[]; budget: boolean }> {
    const t = this.#now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== this.#day) {
      this.#day = today;
      this.#used = 0;
    }
    let budget = true;
    const out = await Promise.all(
      points.map(async ([lat, lon]): Promise<TrafficPoint> => {
        const key = `${cell(lat)},${cell(lon)}`;
        const kept = this.#cache.get(key);
        if (kept && t - kept.at < CACHE_MS) return { lat, lon, ...kept.point };
        if (this.#used >= this.#perDay) {
          budget = false;
          return { lat, lon, level: "unknown", ratio: null };
        }
        this.#used++;
        const point = await this.#ask(Number(cell(lat)), Number(cell(lon)));
        this.#cache.set(key, { at: t, point });
        return { lat, lon, ...point };
      }),
    );
    // Cells not asked for a while are forgotten, so the map does not grow for ever.
    for (const [k, v] of this.#cache) if (t - v.at >= CACHE_MS) this.#cache.delete(k);
    return { points: out, budget };
  }

  async #ask(lat: number, lon: number): Promise<Omit<TrafficPoint, "lat" | "lon">> {
    const url = new URL("https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json");
    url.searchParams.set("key", this.#key!);
    url.searchParams.set("point", `${lat},${lon}`);
    url.searchParams.set("unit", "KMPH");
    try {
      const d = (await this.#fetch(url.toString())).flowSegmentData;
      if (!d) return { level: "unknown", ratio: null };
      const closed = d.roadClosure === true;
      const usable =
        typeof d.currentSpeed === "number" &&
        typeof d.freeFlowSpeed === "number" &&
        d.freeFlowSpeed > 0 &&
        (d.confidence ?? 1) >= MIN_CONFIDENCE;
      const ratio = usable ? Math.round((d.currentSpeed! / d.freeFlowSpeed!) * 100) / 100 : null;
      return { level: levelOf(ratio, closed), ratio };
    } catch {
      // A point TomTom did not answer is not worth failing the others for; the next ask tries again.
      return { level: "unknown", ratio: null };
    }
  }
}
