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

/** A point is about a kilometre wide: the same cell is asked once for every rider in the cache time. */
const cell = (n: number) => n.toFixed(2);
export const MAX_POINTS = 8;

/** What a ratio of current to free-flow speed means for a rider. */
export function levelOf(ratio: number | null, closed: boolean): TrafficLevel {
  if (closed) return "closed";
  if (ratio === null) return "unknown";
  if (ratio >= 0.8) return "free";
  if (ratio >= 0.5) return "slow";
  return "heavy";
}

/** What one provider says of one place: the level and the speed ratio, `unknown` and null when it cannot tell. */
export type PointFlow = Omit<TrafficPoint, "lat" | "lon">;

/**
 * Where the flow comes from (ADR 0041). The cache, the daily cap and the rounding stand above it, so a provider only
 * answers for one place; a place it cannot answer is `unknown`, never an error.
 */
export interface TrafficProvider {
  readonly name: string;
  /**
   * How long an answer for a cell may be kept and shared between riders, ms; 0 for none. TomTom's terms forbid caching
   * "for the purpose of scaling results to serve multiple clients" (clause 11.4), so its provider keeps nothing.
   */
  readonly cacheMs: number;
  /** Whether each place costs a request to a remote service, so the daily cap applies. */
  readonly metered: boolean;
  flowAt(lat: number, lon: number): Promise<PointFlow>;
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

/** Below this confidence TomTom's figure is mostly historical: say nothing rather than guess. */
const MIN_CONFIDENCE = 0.5;

/** TomTom Flow Segment Data: one request per place, the speed now over the speed of an empty road. */
export function tomtomFlowSegment(key: string, get?: (url: string) => Promise<FlowSegment>): TrafficProvider {
  const fetchFlow = get ?? ((url: string) => fetchJson<FlowSegment>(url, {}, 8000));
  return {
    name: "tomtom-flow",
    cacheMs: 0,
    metered: true,
    async flowAt(lat, lon) {
      const url = new URL("https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json");
      url.searchParams.set("key", key);
      url.searchParams.set("point", `${lat},${lon}`);
      url.searchParams.set("unit", "KMPH");
      try {
        const d = (await fetchFlow(url.toString())).flowSegmentData;
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
    },
  };
}

/**
 * The providers a host can choose with `TRAFFIC_PROVIDER`; the first is the default and means no traffic. TomTom is never
 * on by itself: a key in the environment is also the planner's, so the host says it wants it for the phone.
 */
export const PROVIDERS = ["off", "tomtom-flow"] as const;

/** The provider a host chose, or null when it has no key. An unknown name is a configuration mistake, said at once. */
export function providerFor(
  name: string,
  key: string | undefined,
  get?: (url: string) => Promise<FlowSegment>,
): TrafficProvider | null {
  if (!PROVIDERS.includes(name as (typeof PROVIDERS)[number])) {
    throw new Error(`Unknown TRAFFIC_PROVIDER "${name}". Known: ${PROVIDERS.join(", ")}.`);
  }
  if (name === "off" || !key) return null;
  return tomtomFlowSegment(key, get);
}

export interface TrafficOptions {
  /** TomTom key, empty for none; without one the server offers no traffic. Default `TOMTOM_API_KEY`. */
  key?: string;
  /** Which provider answers (default `TRAFFIC_PROVIDER`, else `off`). */
  provider?: string;
  /** For tests: a provider of one's own, instead of one chosen by name. */
  custom?: TrafficProvider;
  /** TomTom requests a day, so a host's quota cannot be used up by their riders (default 600). */
  perDay?: number;
  now?: () => number;
  /** For tests: what TomTom's flow answers for a URL. */
  fetch?: (url: string) => Promise<FlowSegment>;
}

export class TrafficFlow {
  readonly #provider: TrafficProvider | null;
  readonly #perDay: number;
  readonly #now: () => number;
  readonly #cache = new Map<string, { at: number; point: Omit<TrafficPoint, "lat" | "lon"> }>();
  #day = "";
  #used = 0;

  constructor(options: TrafficOptions = {}) {
    const name = options.provider ?? (process.env.TRAFFIC_PROVIDER || PROVIDERS[0]);
    this.#provider =
      options.custom ?? providerFor(name, (options.key ?? process.env.TOMTOM_API_KEY) || undefined, options.fetch);
    this.#perDay = options.perDay ?? (Number(process.env.TRAFFIC_MAX_PER_DAY) || 600);
    this.#now = options.now ?? Date.now;
  }

  /** Whether this server has a provider, and so offers traffic. */
  get available(): boolean {
    return this.#provider !== null;
  }

  /** Flow at each point, from the cache or from TomTom; a point TomTom could not answer is `unknown`. */
  async flow(points: Array<[number, number]>): Promise<{ points: TrafficPoint[]; budget: boolean }> {
    const t = this.#now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== this.#day) {
      this.#day = today;
      this.#used = 0;
    }
    const provider = this.#provider!;
    let budget = true;
    const out = await Promise.all(
      points.map(async ([lat, lon]): Promise<TrafficPoint> => {
        const key = `${cell(lat)},${cell(lon)}`;
        const kept = provider.cacheMs > 0 ? this.#cache.get(key) : undefined;
        if (kept && t - kept.at < provider.cacheMs) return { lat, lon, ...kept.point };
        if (provider.metered) {
          if (this.#used >= this.#perDay) {
            budget = false;
            return { lat, lon, level: "unknown", ratio: null };
          }
          this.#used++;
        }
        const point = await provider.flowAt(Number(cell(lat)), Number(cell(lon)));
        if (provider.cacheMs > 0) this.#cache.set(key, { at: t, point });
        return { lat, lon, ...point };
      }),
    );
    // Cells not asked for a while are forgotten, so the map does not grow for ever.
    for (const [k, v] of this.#cache) if (t - v.at >= provider.cacheMs) this.#cache.delete(k);
    return { points: out, budget };
  }
}
