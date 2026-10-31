import { createHash } from "node:crypto";
import { savedRideGpx, savedRideRoadbook } from "./gpx.ts";
import type { SavedRide, Store } from "./store.ts";

/** A roadbook as the phone lists it: enough to show it and to tell whether the copy it holds is the current one. */
export interface RoadbookListing {
  id: number;
  name: string;
  distanceKm: number;
  ridingMinutes: number;
  /**
   * Changes when the route, the stops, the cameras or the name change, and, on a host that runs its own Valhalla, when its map is
   * rebuilt (the limits come from it); the phone compares it with the one it kept.
   */
  stamp: string;
}

/** What the roadbook file is made of, short and stable: the same saved ride always gives the same stamp. */
export function rideStamp(ride: SavedRide, mapDay = ""): string {
  const content = JSON.stringify([
    ride.name,
    ride.shapes,
    ride.extras?.cameras ?? [],
    ride.extras?.stopPlan ?? null,
    // Added only when there is one, so a host without its own map keeps the stamps it had.
    ...(mapDay ? [mapDay] : []),
  ]);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function listRoadbooks(store: Store, mapDay = ""): RoadbookListing[] {
  return store.listRides().map((ride) => ({
    id: ride.id,
    name: ride.name,
    distanceKm: ride.distanceKm,
    ridingMinutes: ride.ridingMinutes,
    stamp: rideStamp(ride, mapDay),
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
  async get(tenantId: string, store: Store, id: number, mapDay = ""): Promise<{ stamp: string; body: string } | null> {
    const ride = store.findRide(String(id));
    if (!ride) return null;
    const stamp = rideStamp(ride, mapDay);
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
