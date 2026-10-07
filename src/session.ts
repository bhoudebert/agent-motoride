import { overlapPct, routeCells } from "./geometry.ts";
import type { RidePreferences } from "./preferences.ts";
import type { StopPlan } from "./stops.ts";
import type { Store } from "./store.ts";
import type { Point } from "./tools/geo.ts";
import type { TripComputation } from "./tools/trip.ts";
import type { RunUsage } from "./usage.ts";

/** A candidate above this share of already-saved roads is a duplicate. */
export const DUPLICATE_PCT = 70;
/** A candidate above this share is worth mentioning as similar. */
export const SIMILAR_PCT = 40;

/** One step of a planning session, kept for replay. */
export interface TraceEvent {
  /** "main" for the planner, "scout:<area>" for a scout. */
  scope: string;
  kind: "user" | "model" | "tool" | "answer" | "error" | "check";
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
  /** Tool calls made so far, by scope, tool and input, to stop a model repeating one. */
  calls?: Map<string, { count: number; result: string }>;
  /** Guarded repeats in a row, per scope: the planner stops a session stuck on one call. */
  repeatsInARow?: Map<string, number>;
  /** Last route number used, per id prefix; see nextRouteId. */
  routeSeq?: Map<string, number>;
  /** Roads the rider rated, computed once per session from the library. */
  ratedRoads?: RatedRoads;
  /** The session's clock: real time, or the recorded time when an eval replays a session. */
  now?: () => Date;
}

export interface RatedRoads {
  /** Cells of rides, legs or road stretches rated 0 or 1: never again. */
  avoid: Set<string>;
  avoidFrom: string[];
  /** Cells of rides or legs rated 4 or 5. */
  loved: Set<string>;
  lovedFrom: string[];
}

/**
 * Rating 0 or 1 means avoid, 4 or 5 means loved; a leg's own rating wins over the ride's.
 * Road stretches rated from ride notes count the same way.
 */
export function ratedRoads(context: RideContext): RatedRoads {
  if (context.ratedRoads) return context.ratedRoads;
  const avoid = new Set<string>();
  const loved = new Set<string>();
  const avoidFrom: string[] = [];
  const lovedFrom: string[] = [];
  for (const ride of context.store.listRides()) {
    if (!ride.shapes) continue;
    ride.legs.forEach((leg, i) => {
      const rating = leg.rating ?? ride.rating;
      if (rating === null || rating === undefined) return;
      const shape = ride.shapes![i];
      if (!shape) return;
      const target = rating <= 1 ? avoid : rating >= 4 ? loved : null;
      if (!target) return;
      for (const cell of routeCells([shape])) target.add(cell);
      (rating <= 1 ? avoidFrom : lovedFrom).push(
        `#${ride.id} leg ${leg.seq} (${leg.from} -> ${leg.to}, rated ${rating})`,
      );
    });
  }
  // Stretches rated from notes after a ride, on the road actually ridden.
  for (const road of context.store.listRoadRatings()) {
    const target = road.rating <= 1 ? avoid : road.rating >= 4 ? loved : null;
    if (!target) continue;
    for (const cell of road.cells) target.add(cell);
    (road.rating <= 1 ? avoidFrom : lovedFrom).push(
      `${road.road} (rated ${road.rating}${road.reason ? `: "${road.reason}"` : ""})`,
    );
  }
  context.ratedRoads = { avoid, avoidFrom, loved, lovedFrom };
  return context.ratedRoads;
}

/** Overlap of a candidate with roads the rider rated. */
export function ratedOverlap(context: RideContext, cells: string[]) {
  const rated = ratedRoads(context);
  const avoidPct = overlapPct(cells, rated.avoid);
  const lovedPct = overlapPct(cells, rated.loved);
  return {
    avoidPct,
    lovedPct,
    verdict:
      avoidPct >= 10
        ? `AVOID: ${avoidPct}% of this route is on roads the rider rated 0 or 1 (${rated.avoidFrom.slice(0, 3).join("; ")}). Not valid unless nothing else meets the hard limits; say so if you keep it.`
        : avoidPct > 0
          ? `${avoidPct}% on roads rated 0 or 1; acceptable if short, better bypassed`
          : lovedPct >= 20
            ? `${lovedPct}% on roads the rider loves (rated 4-5): a plus`
            : "no rated roads involved",
  };
}

/** A saved ride this candidate would duplicate, if any (outside the session's own lineage). */
export function duplicateOf(
  context: RideContext,
  cells: string[],
): { rideId: number; name: string; overlapPct: number } | undefined {
  for (const ride of context.store.listRides()) {
    if (context.lineage.has(ride.id)) continue;
    const pct = overlapPct(cells, new Set(ride.cells));
    if (pct >= DUPLICATE_PCT) return { rideId: ride.id, name: ride.name, overlapPct: pct };
  }
  return undefined;
}

/**
 * Reserve the id of the next routed trip of a scope: "r1", "r2" for the planner,
 * "vercors-r1" for the scout of the Vercors. Taken synchronously when the call
 * starts, so ids follow the order of the tool calls, not the order in which
 * parallel routing requests happen to finish: a replayed session gets the same ids.
 */
export function nextRouteId(context: RideContext, scope = "main"): string {
  const prefix =
    scope === "main"
      ? "r"
      : `${
          scope
            .replace(/^scout:/, "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "scout"
        }-r`;
  context.routeSeq ??= new Map();
  const n = (context.routeSeq.get(prefix) ?? 0) + 1;
  context.routeSeq.set(prefix, n);
  return `${prefix}${n}`;
}

export function registerRoute(context: RideContext, trip: TripComputation, id = nextRouteId(context)): RegisteredRoute {
  const route = { id, trip, cells: routeCells(trip.shapes) };
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
    ? `variant of roadbook #${base.rideId} "${base.name}", the ride this session evolves (${base.overlapPct}% same roads, as expected)`
    : "new: no significant overlap with saved rides";
  if (worst && worst.overlapPct >= DUPLICATE_PCT) {
    verdict = context.allowRepeat
      ? `repeat of roadbook #${worst.rideId} "${worst.name}" (${worst.overlapPct}% same roads); repeats are allowed this session`
      : `DUPLICATE of roadbook #${worst.rideId} "${worst.name}" (${worst.overlapPct}% same roads). Do not propose it unless the rider asked for a variant of that ride; pick other roads or another area.`;
  } else if (worst && worst.overlapPct >= SIMILAR_PCT) {
    verdict = `similar to roadbook #${worst.rideId} "${worst.name}" (${worst.overlapPct}% same roads); acceptable, mention it to the rider`;
  }
  return { verdict, overlaps };
}
