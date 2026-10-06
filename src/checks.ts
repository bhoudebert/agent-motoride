// Code checks of an itinerary before the rider sees it: the hard limits read
// from the rider's own words, and the rules the code enforces elsewhere.
import { duplicateOf, type RegisteredRoute, type RideContext, ratedOverlap } from "./session.ts";

export interface RequestLimits {
  maxDistanceKm: number | null;
  maxRidingMinutes: number | null;
}

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};
const CAP = String.raw`(?:under|below|less than|at most|max(?:imum)?|no more than|up to|within|<=?|≤)`;
const NUMBER = String.raw`(\d+(?:[.,]\d+)?|a|an|one|two|three|four|five|six|seven|eight)`;
const AFTER = String.raw`(?:\s+\w+){0,3}?\s*(?:max(?:imum)?|at most|tops)\b`;

const toNumber = (text: string) => WORDS[text.toLowerCase()] ?? Number(text.replace(",", "."));

/**
 * Distance and riding-time caps stated in the rider's words: "under 250 km",
 * "<250km", "at most two hours of riding", "2h max", "90 minutes max".
 * "About 150 km" is a wish, not a cap, and is not read as one.
 */
export function parseLimits(request: string): RequestLimits {
  const distance =
    new RegExp(String.raw`${CAP}\s*(\d{2,4})\s*km\b`, "i").exec(request) ??
    new RegExp(String.raw`\b(\d{2,4})\s*km${AFTER}`, "i").exec(request);
  const hours =
    new RegExp(String.raw`${CAP}\s*${NUMBER}\s*(?:h\b|hours?\b|hrs?\b)`, "i").exec(request) ??
    new RegExp(String.raw`\b${NUMBER}\s*(?:h|hours?|hrs?)\b${AFTER}`, "i").exec(request);
  const minutes =
    new RegExp(String.raw`${CAP}\s*(\d{2,3})\s*(?:min|minutes)\b`, "i").exec(request) ??
    new RegExp(String.raw`\b(\d{2,3})\s*(?:min|minutes)${AFTER}`, "i").exec(request);
  return {
    maxDistanceKm: distance ? Number(distance[1]) : null,
    maxRidingMinutes: hours ? Math.round(toNumber(hours[1]!) * 60) : minutes ? Number(minutes[1]) : null,
  };
}

/** Share of fast expressway above which a leisure itinerary goes back to the planner. */
export const FAST_EXPRESSWAY_MAX_PCT = 25;

/** Wording by which an answer owns up to a limit it does not meet. */
const ACKNOWLEDGED =
  /\b(over the|exceeds?|above the|beyond|longer than|more than the|cannot|can't|can not|not possible|impossible|closest option|not a full match|breaks?)\b/i;

/**
 * What is wrong with an itinerary, one line per failed check; empty when it
 * passes. `acknowledged` is set when the answer already says it misses a limit.
 */
export function checkItinerary(
  context: RideContext,
  route: RegisteredRoute,
  message: string,
  limits: RequestLimits,
): { violations: string[]; acknowledged: boolean } {
  const trip = route.trip.result;
  const violations: string[] = [];
  if (limits.maxDistanceKm !== null && trip.totalDistanceKm > limits.maxDistanceKm) {
    violations.push(`distance: routed ${trip.totalDistanceKm} km, over the rider's ${limits.maxDistanceKm} km limit`);
  }
  if (limits.maxRidingMinutes !== null && trip.totalRidingMinutes > limits.maxRidingMinutes) {
    violations.push(
      `riding time: ${trip.totalRidingTime} estimated, over the rider's ${limits.maxRidingMinutes} minutes limit`,
    );
  }
  if (context.preferences.avoidMotorways && trip.usesMotorway) {
    violations.push("motorways: the route uses a motorway, and the rider forbids them");
  }
  const duplicate = context.allowRepeat ? undefined : duplicateOf(context, route.cells);
  if (duplicate) {
    violations.push(
      `repeat: ${duplicate.overlapPct}% of the roads of saved ride #${duplicate.rideId} "${duplicate.name}"`,
    );
  }
  // Not a motorway, but a leisure ride mostly on 100+ expressways is not a motorcycle ride.
  // A rider who permits motorways is on a practical trip, where they are fine.
  const fast = (trip.speedLimits as { fastExpressway?: { pct: number; longest: Array<{ road: string }> } } | undefined)
    ?.fastExpressway;
  if (context.preferences.avoidMotorways && fast && fast.pct >= FAST_EXPRESSWAY_MAX_PCT) {
    violations.push(
      `fast expressway: ${fast.pct}% of the ride on roads limited to 100 km/h or more that are not motorways (${fast.longest
        .slice(0, 2)
        .map((r) => r.road)
        .join(", ")}); route around them for a leisure ride, or say why not`,
    );
  }
  const { avoidPct } = ratedOverlap(context, route.cells);
  if (avoidPct >= 10) violations.push(`rated roads: ${avoidPct}% on roads the rider rated 0 or 1`);
  const stated = [...message.matchAll(/(\d+(?:[.,]\d+)?)\s*km\b/g)].map((m) => Number(m[1]!.replace(",", ".")));
  if (!stated.some((km) => Math.abs(km - trip.totalDistanceKm) <= 1.5)) {
    violations.push(`figures: the answer does not state the routed distance, ${trip.totalDistanceKm} km`);
  }
  return { violations, acknowledged: ACKNOWLEDGED.test(message) };
}

/** The message that sends a failed itinerary back to the planner. */
export function correctionMessage(violations: string[]): string {
  return `[Automatic check by code, not from the rider. The itinerary you presented fails these checks:\n${violations.map((v) => `- ${v}`).join("\n")}\nFix it (route again if needed) and answer again in full. If a limit cannot be met, say so plainly in the answer and present the closest option.]`;
}
