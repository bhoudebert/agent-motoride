import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tenantDbPath, tenantDir } from "./dataDir.ts";
import { savedRideGpx, savedRideRoadbook } from "./gpx.ts";
import { Store, type SavedRide } from "./store.ts";

/**
 * Where a roadbook stands for the phone: `current` (the ready file is made from the roadbook as it is now, on the map in
 * use), `outdated` (the ready file is older, or there is none yet), `refreshing` (the server is making a new one) or `failed`
 * (the last try failed; the ready file, if any, is still served).
 */
export type RoadbookState = "current" | "outdated" | "refreshing" | "failed";

/** A roadbook as the phone lists it: enough to show it and to tell whether the copy it holds is the current one. */
export interface RoadbookListing {
  id: number;
  name: string;
  distanceKm: number;
  ridingMinutes: number;
  /** The version of the file ready to download; the phone compares it with the one it kept. */
  stamp: string;
  state: RoadbookState;
  /** The day (UTC) of the own Valhalla map the ready file was made on; absent when the host runs none. */
  mapDay?: string;
  /** Why the last refresh failed, in one short sentence a rider can read, when `state` is `failed`. */
  error?: string;
  /** A stable name for the reason, so an app can translate it: `map_down`, `rate_limited`, `timeout` or `other`. */
  errorCode?: "map_down" | "rate_limited" | "timeout" | "other";
}

/** What a failed refresh is told as: the reason in a few words for the rider, and a code. The detail goes to the server's log. */
export function describeFailure(e: unknown): { code: NonNullable<RoadbookListing["errorCode"]>; error: string } {
  const text = e instanceof Error ? e.message : String(e);
  if (/\b429\b/.test(text)) return { code: "rate_limited", error: "The map server is busy; try again later." };
  if (/timeout|timed out|aborted/i.test(text)) return { code: "timeout", error: "The map server took too long." };
  if (/No Valhalla server answered|fetch failed|ECONNREFUSED|\b5\d\d\b/.test(text))
    return { code: "map_down", error: "The map server did not answer." };
  return { code: "other", error: "The roadbook could not be made." };
}

/** What the roadbook file is made of, short and stable: the same saved ride always gives the same content. */
function fingerprint(ride: SavedRide): string {
  return JSON.stringify([ride.name, ride.shapes, ride.extras?.cameras ?? [], ride.extras?.stopPlan ?? null]);
}

/** The version of a roadbook file: the roadbook's content, and the map of the host's own Valhalla it was made on, if any. */
export function rideStamp(ride: SavedRide, mapDay = ""): string {
  // The map day is added only when there is one, so a host without its own map keeps the stamps it had.
  const content = mapDay
    ? JSON.stringify([...(JSON.parse(fingerprint(ride)) as unknown[]), mapDay])
    : fingerprint(ride);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export type MakeRoadbookFile = (store: Store, ride: SavedRide) => Promise<string>;

export const traceRoadbookFile: MakeRoadbookFile = async (store, ride) => {
  const { gpx } = await savedRideGpx(store, ride);
  return JSON.stringify((await savedRideRoadbook(ride, gpx)).file);
};

interface Meta {
  stamp: string;
  fingerprint: string;
  mapDay: string;
  madeAt: string;
}

interface Failure {
  at: number;
  error: string;
  code: NonNullable<RoadbookListing["errorCode"]>;
  fingerprint: string;
  mapDay: string;
}

export interface ReadyOptions {
  make?: MakeRoadbookFile;
  /** The day of the host's own Valhalla map, "" when it runs none. */
  mapDay?: () => Promise<string>;
  now?: () => number;
  /** Refreshes running at once for the whole server. */
  concurrency?: number;
  /** Refreshes waiting or running at most; the rest wait for the next ask. */
  maxJobs?: number;
  /** How long a failed refresh is left alone before a list asks again, ms. */
  retryAfterMs?: number;
  /** A ride this soon (days) is refreshed by the list; the others wait for the rider's tap. */
  soonDays?: number;
}

/**
 * The roadbook files of the riders, ready to download. A file is made once for a roadbook as it is and the map it was made on,
 * kept on disk, and served at once; a change of the roadbook or of the map makes it `outdated` and a new one is made in the
 * background, on the rider's tap or, for a ride dated soon, when the phone lists. Nothing here looks at riders who are not asking.
 */
export class ReadyRoadbooks {
  readonly #make: MakeRoadbookFile;
  readonly #mapDay: () => Promise<string>;
  readonly #now: () => number;
  readonly #concurrency: number;
  readonly #maxJobs: number;
  readonly #retryAfterMs: number;
  readonly #soonMs: number;
  readonly #jobs = new Map<string, Promise<void>>();
  readonly #failures = new Map<string, Failure>();
  readonly #waiting: Array<() => void> = [];
  #running = 0;

  constructor(options: ReadyOptions = {}) {
    this.#make = options.make ?? traceRoadbookFile;
    this.#mapDay = options.mapDay ?? (async () => "");
    this.#now = options.now ?? Date.now;
    this.#concurrency = options.concurrency ?? 1;
    this.#maxJobs = options.maxJobs ?? 200;
    this.#retryAfterMs = options.retryAfterMs ?? 5 * 60_000;
    this.#soonMs = (options.soonDays ?? 14) * 24 * 3_600_000;
  }

  #dir(tenantId: string): string {
    return join(tenantDir(tenantId), "roadbooks-ready");
  }

  #meta(tenantId: string, id: number): Meta | null {
    try {
      const meta = JSON.parse(readFileSync(join(this.#dir(tenantId), `${id}.meta.json`), "utf8")) as Meta;
      return typeof meta.stamp === "string" && typeof meta.fingerprint === "string" ? meta : null;
    } catch {
      return null;
    }
  }

  /** Writes the file, then its description, each in one move, so a reader never sees half of one. */
  #keep(tenantId: string, id: number, body: string, meta: Meta): void {
    const dir = this.#dir(tenantId);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of [
      [`${id}.json`, body],
      [`${id}.meta.json`, JSON.stringify(meta)],
    ] as const) {
      const tmp = join(dir, `${name}.tmp`);
      writeFileSync(tmp, content);
      renameSync(tmp, join(dir, name));
    }
  }

  async #slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#concurrency) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#running++;
    try {
      return await work();
    } finally {
      this.#running--;
      this.#waiting.shift()?.();
    }
  }

  /** Makes and keeps the file of roadbook `id` as it is now, on the map in use. Throws when it cannot be made. */
  async #produce(tenantId: string, id: number): Promise<void> {
    const store = new Store(tenantDbPath(tenantId));
    try {
      const ride = store.findRide(String(id));
      if (!ride) return;
      const mapDay = await this.#mapDay();
      const body = await this.#make(store, ride);
      this.#keep(tenantId, id, body, {
        stamp: rideStamp(ride, mapDay),
        fingerprint: fingerprint(ride),
        mapDay,
        madeAt: new Date(this.#now()).toISOString(),
      });
      this.#failures.delete(`${tenantId}:${id}`);
    } finally {
      store.close();
    }
  }

  /** Starts making the file, behind the others; false when too many are waiting. A failure is written down, not thrown. */
  #enqueue(tenantId: string, ride: SavedRide, mapDay: string): boolean {
    const key = `${tenantId}:${ride.id}`;
    if (this.#jobs.has(key)) return true;
    if (this.#jobs.size >= this.#maxJobs) return false;
    const job = this.#slot(() => this.#produce(tenantId, ride.id))
      .catch((e: unknown) => {
        this.#failures.set(key, {
          at: this.#now(),
          ...describeFailure(e),
          fingerprint: fingerprint(ride),
          mapDay,
        });
        console.error(`[roadbook refresh] ${tenantId} #${ride.id}: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => this.#jobs.delete(key));
    this.#jobs.set(key, job);
    return true;
  }

  #stateOf(tenantId: string, ride: SavedRide, mapDay: string): RoadbookListing["state"] {
    const key = `${tenantId}:${ride.id}`;
    if (this.#jobs.has(key)) return "refreshing";
    const meta = this.#meta(tenantId, ride.id);
    if (meta && meta.fingerprint === fingerprint(ride) && meta.mapDay === mapDay) return "current";
    const failure = this.#failures.get(key);
    if (
      failure &&
      failure.fingerprint === fingerprint(ride) &&
      failure.mapDay === mapDay &&
      this.#now() - failure.at < this.#retryAfterMs
    )
      return "failed";
    return "outdated";
  }

  /**
   * The rider's roadbooks with the version ready to download and where each stands. It answers at once: it asks the map's day
   * and reads small files, and starts (never waits for) the refresh of a roadbook that is outdated and has a ride dated soon.
   */
  async list(tenantId: string, store: Store): Promise<RoadbookListing[]> {
    const mapDay = await this.#mapDay();
    const rides = store.listRides();
    const today = this.#now();
    const out = rides.map((ride) => {
      let state = this.#stateOf(tenantId, ride, mapDay);
      if (state === "outdated" && ride.rideDate) {
        const ahead = Date.parse(`${ride.rideDate}T00:00:00Z`) - today;
        if (ahead > -24 * 3_600_000 && ahead <= this.#soonMs && this.#enqueue(tenantId, ride, mapDay))
          state = "refreshing";
      }
      const meta = this.#meta(tenantId, ride.id);
      const failure = state === "failed" ? this.#failures.get(`${tenantId}:${ride.id}`) : undefined;
      return {
        id: ride.id,
        name: ride.name,
        distanceKm: ride.distanceKm,
        ridingMinutes: ride.ridingMinutes,
        // With no ready file the stamp is the one the file will have; a phone that downloads then waits for it to be made.
        stamp: meta?.stamp ?? rideStamp(ride, mapDay),
        state,
        ...((meta?.mapDay ?? mapDay) ? { mapDay: meta?.mapDay ?? mapDay } : {}),
        ...(failure ? { error: failure.error, errorCode: failure.code } : {}),
      };
    });
    this.#prune(
      tenantId,
      rides.map((r) => r.id),
    );
    return out;
  }

  /** Forgets the files of roadbooks that no longer exist. */
  #prune(tenantId: string, live: number[]): void {
    let names: string[];
    try {
      names = readdirSync(this.#dir(tenantId));
    } catch {
      return;
    }
    for (const name of names) {
      const id = Number(/^(\d+)\./.exec(name)?.[1]);
      if (Number.isInteger(id) && !live.includes(id)) rmSync(join(this.#dir(tenantId), name), { force: true });
    }
  }

  /**
   * The file ready for roadbook `id`, at once, even when it is outdated; null when there is no such roadbook. When there is no
   * file yet it is made now (the first time only) and the caller waits for it; a failure then is thrown and not kept.
   */
  async get(tenantId: string, store: Store, id: number): Promise<{ stamp: string; body: string } | null> {
    const ride = store.findRide(String(id));
    if (!ride) return null;
    const read = (): { stamp: string; body: string } | null => {
      const meta = this.#meta(tenantId, id);
      if (!meta) return null;
      try {
        return { stamp: meta.stamp, body: readFileSync(join(this.#dir(tenantId), `${id}.json`), "utf8") };
      } catch {
        return null;
      }
    };
    const ready = read();
    if (ready) return ready;
    const key = `${tenantId}:${id}`;
    const running = this.#jobs.get(key);
    if (running) await running;
    else {
      // The first file of a roadbook: made now, in front of the refreshes that wait.
      const job = this.#produce(tenantId, id).finally(() => this.#jobs.delete(key));
      this.#jobs.set(
        key,
        job.catch(() => undefined),
      );
      await job;
    }
    const made = read();
    if (!made) throw new Error("The roadbook file could not be made.");
    return made;
  }

  /**
   * The rider asks for a refresh of roadbook `id`: it starts at once if it is outdated and the answer is the state. Null when
   * there is no such roadbook. A failed one is tried again when the rider asks.
   */
  async refresh(tenantId: string, store: Store, id: number): Promise<RoadbookState | null> {
    const ride = store.findRide(String(id));
    if (!ride) return null;
    const mapDay = await this.#mapDay();
    this.#failures.delete(`${tenantId}:${id}`);
    const state = this.#stateOf(tenantId, ride, mapDay);
    if (state !== "outdated") return state;
    return this.#enqueue(tenantId, ride, mapDay) ? "refreshing" : "outdated";
  }

  /** Waits for every refresh running or waiting (tests, and a clean stop). */
  async idle(): Promise<void> {
    while (this.#jobs.size) await Promise.all([...this.#jobs.values()]);
  }
}
