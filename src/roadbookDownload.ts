import { createHash } from "node:crypto";
import { savedRideGpx, savedRideRoadbook } from "./gpx.ts";
import type { SavedRide, Store } from "./store.ts";

/** A roadbook as the phone lists it: enough to show it and to tell whether the copy it holds is the current one. */
export interface RoadbookListing {
  id: number;
  name: string;
  distanceKm: number;
  ridingMinutes: number;
  /** Changes when the route, the stops, the cameras or the name change; the phone compares it with the one it kept. */
  stamp: string;
}

/** What the roadbook file is made of, short and stable: the same saved ride always gives the same stamp. */
export function rideStamp(ride: SavedRide): string {
  const content = JSON.stringify([ride.name, ride.shapes, ride.extras?.cameras ?? [], ride.extras?.stopPlan ?? null]);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function listRoadbooks(store: Store): RoadbookListing[] {
  return store.listRides().map((ride) => ({
    id: ride.id,
    name: ride.name,
    distanceKm: ride.distanceKm,
    ridingMinutes: ride.ridingMinutes,
    stamp: rideStamp(ride),
  }));
}

/**
 * The roadbook files made so far, by rider, roadbook and stamp: making one traces the route on the public router, so a
 * phone asking again (or several phones) must not trace again. Bounded; the oldest goes first.
 */
export type MakeRoadbookFile = (store: Store, ride: SavedRide) => Promise<string>;

const traceRoadbookFile: MakeRoadbookFile = async (store, ride) => {
  const { gpx } = await savedRideGpx(store, ride);
  return JSON.stringify((await savedRideRoadbook(ride, gpx)).file);
};

export class RoadbookFiles {
  readonly #made = new Map<string, Promise<string>>();
  readonly #max: number;
  readonly #make: MakeRoadbookFile;

  constructor(make: MakeRoadbookFile = traceRoadbookFile, max = 100) {
    this.#make = make;
    this.#max = max;
  }

  /** The file of roadbook `id` of the rider, or null when there is no such roadbook. A failure is not kept. */
  async get(tenantId: string, store: Store, id: number): Promise<{ stamp: string; body: string } | null> {
    const ride = store.findRide(String(id));
    if (!ride) return null;
    const stamp = rideStamp(ride);
    const key = `${tenantId}:${id}:${stamp}`;
    let made = this.#made.get(key);
    if (!made) {
      made = this.#make(store, ride);
      this.#made.set(key, made);
      made.catch(() => this.#made.delete(key));
      while (this.#made.size > this.#max) this.#made.delete(this.#made.keys().next().value!);
    }
    return { stamp, body: await made };
  }
}
