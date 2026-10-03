import { overlapPct, routeCells } from "./geometry.ts";
import type { RidePreferences } from "./preferences.ts";
import type { Store } from "./store.ts";
import type { Point } from "./tools/geo.ts";
import type { TripComputation } from "./tools/trip.ts";
import type { StopPlan } from "./stops.ts";
import type { RunUsage } from "./usage.ts";

/** A candidate above this share of already-saved roads is a duplicate. */
export const DUPLICATE_PCT = 70;
/** A candidate above this share is worth mentioning as similar. */
export const SIMILAR_PCT = 40;

/** One step of a planning session, kept for replay. */
export interface TraceEvent {
  /** "main" for the planner, "scout:<area>" for a scout. */
  scope: string;
  kind: "user" | "model" | "tool" | "answer" | "error";
  name: string;
  ms?: number;
  payload: unknown;
}

export interface RegisteredRoute {
  id: string;
  trip: TripComputation;
  cells: string[];
}

/** Everything one planning session shares between the agent, its tools and the CLI. */
export interface RideContext {
  store: Store;
  preferences: RidePreferences;
  home: Point;
  /** When true, rides similar to saved ones are reported but not rejected. */
  allowRepeat: boolean;
  /** Saved rides this session derives from; overlapping them is expected. */
  lineage: Set<number>;
  /** Every trip routed this session, by route ID. */
  routes: Map<string, RegisteredRoute>;
  /** Row of this session in the runs table. */
  runId: number;
  /** Tokens and time consumed so far, by the planner and its scouts together. */
  usage: RunUsage;
  /** Record one step for later replay. */
  trace: (event: TraceEvent) => void;
  /** Stop plans made this session, by route id, so links and GPX can carry the stops. */
  stopPlans: Map<string, StopPlan>;
}

export function registerRoute(context: RideContext, trip: TripComputation): RegisteredRoute {
  const route = { id: `r${context.routes.size + 1}`, trip, cells: routeCells(trip.shapes) };
  context.routes.set(route.id, route);
  return route;
}

/** How much of a candidate route runs on roads of rides already saved. */
export function savedRideOverlap(context: RideContext, cells: string[]) {
  const overlaps = context.store
    .listRides()
    .map((ride) => ({
      rideId: ride.id,
      name: ride.name,
      overlapPct: overlapPct(cells, new Set(ride.cells)),
      rating: ride.rating,
      baseRideOfThisSession: context.lineage.has(ride.id),
    }))
    .filter((o) => o.overlapPct >= 20)
    .sort((a, b) => b.overlapPct - a.overlapPct)
    .slice(0, 3);

  const worst = overlaps.find((o) => !o.baseRideOfThisSession);
  const base = overlaps.find((o) => o.baseRideOfThisSession);
  let verdict = base
    ? `variant of saved ride #${base.rideId} "${base.name}", the ride this session evolves (${base.overlapPct}% same roads, as expected)`
    : "new: no significant overlap with saved rides";
  if (worst && worst.overlapPct >= DUPLICATE_PCT) {
    verdict = context.allowRepeat
      ? `repeat of saved ride #${worst.rideId} "${worst.name}" (${worst.overlapPct}% same roads); repeats are allowed this session`
      : `DUPLICATE of saved ride #${worst.rideId} "${worst.name}" (${worst.overlapPct}% same roads). Do not propose it unless the rider asked for a variant of that ride; pick other roads or another area.`;
  } else if (worst && worst.overlapPct >= SIMILAR_PCT) {
    verdict = `similar to saved ride #${worst.rideId} "${worst.name}" (${worst.overlapPct}% same roads); acceptable, mention it to the rider`;
  }
  return { verdict, overlaps };
}
