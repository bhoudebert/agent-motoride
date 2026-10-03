import type { BikeProfile } from "./profile.ts";
import { isOpenAt, type OpenState } from "./hours.ts";
import { describeCoords } from "./tools/geo.ts";
import type { TripLeg } from "./tools/trip.ts";

export interface StopCandidate {
  kmAlongRoute: number;
  leg: number;
  name: string;
  openingHours: string | null;
  detourM: number;
  coords: string;
  /** Town or village from the address tags, when mapped. */
  place?: string | null;
  street?: string | null;
}

export interface PlannedStop {
  kind: "fuel" | "pause" | "lunch";
  name: string;
  kmAlongRoute: number;
  leg: number;
  /** Clock time of arrival at the stop, from the departure and the riding time. */
  eta: string;
  coords: string;
  openingHours: string | null;
  detourM: number;
  reason: string;
  /** Where it is, in words: street and village, or the road and the nearest village. */
  where: string;
  /** Open at the arrival time on the ride date, from the opening_hours tag; "unknown" when not tagged or not readable. */
  openAtArrival: OpenState;
}

export interface StopPlan {
  /** Ride date the opening hours were checked against, if any. */
  date: string | null;
  fuelAtStartKm: number;
  stops: PlannedStop[];
  warnings: string[];
}

/** Street and village from the address tags, or empty when the map has none. */
const addressOf = (c: StopCandidate) => [c.street, c.place].filter(Boolean).join(", ");

/**
 * Fill in the location of each stop in words. Stops with a mapped address keep
 * it; the others get the road and nearest village from reverse geocoding.
 */
export async function locateStops(plan: StopPlan): Promise<StopPlan> {
  for (const stop of plan.stops) {
    // A full address (street and village) stands; otherwise the road and nearest village.
    if (stop.where.includes(",")) continue;
    const [lat = 0, lon = 0] = stop.coords.split(",").map(Number);
    const nearby = await describeCoords(lat, lon);
    stop.where = stop.where && !nearby.includes(stop.where) ? `${nearby}, ${stop.where}` : nearby;
  }
  return plan;
}

const hhmm = (minutes: number) => `${String(Math.floor(((minutes % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

/** Riding minutes from the start to a km mark, interpolated inside the leg. */
function minutesAt(legs: TripLeg[], km: number): number {
  let startKm = 0;
  let minutes = 0;
  for (const leg of legs) {
    const endKm = startKm + leg.distanceKm;
    if (km <= endKm || leg === legs.at(-1)) return minutes + ((km - startKm) / Math.max(leg.distanceKm, 0.1)) * leg.ridingMinutes;
    startKm = endKm;
    minutes += leg.ridingMinutes;
  }
  return minutes;
}

function kmAt(legs: TripLeg[], minutes: number): number {
  let startKm = 0;
  let elapsed = 0;
  for (const leg of legs) {
    if (minutes <= elapsed + leg.ridingMinutes || leg === legs.at(-1)) return startKm + ((minutes - elapsed) / Math.max(leg.ridingMinutes, 1)) * leg.distanceKm;
    elapsed += leg.ridingMinutes;
    startKm += leg.distanceKm;
  }
  return startKm;
}

/**
 * Choose the stops of a ride from the candidates near the route:
 * - fuel: the last station before each fuel deadline (fuel at start, then
 *   range, each minus the reserve), so the tank never runs into reserve;
 * - pauses: a café or bakery close to each pause mark, by riding time;
 * - lunch: a restaurant where the ride crosses midday, if the profile asks.
 * A stop already placed resets the pause clock. Times assume no delays.
 */
export function planStops(
  legs: TripLeg[],
  candidates: { fuel: StopCandidate[]; cafe: StopCandidate[]; bakery: StopCandidate[]; restaurant: StopCandidate[] },
  profile: BikeProfile,
  departure: string,
  fuelAtStartKm = profile.tankRangeKm,
  date: string | null = null,
): StopPlan {
  const totalKm = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
  const totalMin = legs.reduce((sum, leg) => sum + leg.ridingMinutes, 0);
  const [dh = 9, dm = 0] = departure.split(":").map(Number);
  const departMin = dh * 60 + dm;
  const warnings: string[] = [];
  const stops: PlannedStop[] = [];
  const legAt = (km: number) => Math.max(1, legs.findIndex((leg, i) => km <= legs.slice(0, i + 1).reduce((s, l) => s + l.distanceKm, 0)) + 1);
  const pauseMinutes = 15;
  let breakMinutes = 0;
  const eta = (km: number) => hhmm(departMin + minutesAt(legs, km) + breakMinutes);
  const openAt = (c: StopCandidate): OpenState => (date ? isOpenAt(c.openingHours, date, eta(c.kmAlongRoute)) : "unknown");
  // Prefer places open at arrival; unknown hours are acceptable; closed ones only as a last resort.
  const openFirst = <T extends StopCandidate>(list: T[]): T[] => {
    const rank = (c: T) => ({ open: 0, unknown: 1, closed: 2 })[openAt(c)];
    return [...list].sort((a, b) => rank(a) - rank(b));
  };

  // Fuel: deadline after deadline until the finish is within reach.
  let deadline = fuelAtStartKm - profile.reserveKm;
  while (deadline < totalKm) {
    const before = candidates.fuel.filter((f) => f.kmAlongRoute <= deadline && f.kmAlongRoute > (stops.filter((s) => s.kind === "fuel").at(-1)?.kmAlongRoute ?? 0) + 5);
    const byKm = before.sort((a, b) => b.kmAlongRoute - a.kmAlongRoute);
    const chosen = byKm.find((f) => openAt(f) !== "closed") ?? byKm[0];
    if (!chosen) {
      warnings.push(`No fuel station found before km ${deadline.toFixed(0)}; fuel up before leaving or extend the search radius.`);
      break;
    }
    stops.push({
      kind: "fuel",
      name: chosen.name,
      kmAlongRoute: chosen.kmAlongRoute,
      leg: chosen.leg,
      eta: eta(chosen.kmAlongRoute),
      coords: chosen.coords,
      openingHours: chosen.openingHours,
      detourM: chosen.detourM,
      reason: `last station before the ${deadline.toFixed(0)} km fuel deadline`,
      where: addressOf(chosen),
      openAtArrival: openAt(chosen),
    });
    breakMinutes += 10;
    deadline = chosen.kmAlongRoute + profile.tankRangeKm - profile.reserveKm;
  }

  // Lunch: a restaurant where the ride crosses 12:30, when the ride spans midday.
  const lunchClock = 12 * 60 + 30;
  if (profile.lunch && departMin < lunchClock && departMin + totalMin > lunchClock - 30) {
    const lunchKm = kmAt(legs, lunchClock - departMin - breakMinutes);
    const near = openFirst(
      candidates.restaurant
        .filter((r) => Math.abs(r.kmAlongRoute - lunchKm) <= Math.max(15, totalKm * 0.1))
        .sort((a, b) => Math.abs(a.kmAlongRoute - lunchKm) + a.detourM / 1000 - (Math.abs(b.kmAlongRoute - lunchKm) + b.detourM / 1000)),
    )[0];
    if (near) {
      stops.push({ kind: "lunch", name: near.name, kmAlongRoute: near.kmAlongRoute, leg: near.leg, eta: eta(near.kmAlongRoute), coords: near.coords, openingHours: near.openingHours, detourM: near.detourM, reason: "around 12:30 on the route", where: addressOf(near), openAtArrival: openAt(near) });
      breakMinutes += 45;
    } else warnings.push(`No restaurant mapped near km ${lunchKm.toFixed(0)}, where the ride passes midday.`);
  }

  // Pauses: by riding time since the last stop of any kind.
  const placed = () => [...stops].sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
  let lastStopMin = 0;
  let guard = 0;
  while (guard++ < 10) {
    const sinceStops = placed().map((s) => minutesAt(legs, s.kmAlongRoute));
    const nextAfter = sinceStops.filter((m) => m > lastStopMin).sort((a, b) => a - b)[0] ?? totalMin;
    const target = lastStopMin + profile.pauseEveryMin;
    if (target >= nextAfter - 15) {
      // An existing stop (fuel, lunch) comes first and resets the clock.
      if (nextAfter >= totalMin) break;
      lastStopMin = nextAfter;
      continue;
    }
    const targetKm = kmAt(legs, target);
    const pool = [...candidates.cafe, ...candidates.bakery];
    const near = openFirst(
      pool
        .filter((c) => Math.abs(c.kmAlongRoute - targetKm) <= 12)
        .sort((a, b) => Math.abs(a.kmAlongRoute - targetKm) + a.detourM / 1000 - (Math.abs(b.kmAlongRoute - targetKm) + b.detourM / 1000)),
    )[0];
    if (!near) {
      if (target + profile.maxStintMin - profile.pauseEveryMin < nextAfter) warnings.push(`No café or bakery mapped near km ${targetKm.toFixed(0)}; stint without a stop reaches ${Math.round(nextAfter - lastStopMin)} min.`);
      lastStopMin = nextAfter;
      continue;
    }
    stops.push({ kind: "pause", name: near.name, kmAlongRoute: near.kmAlongRoute, leg: near.leg, eta: eta(near.kmAlongRoute), coords: near.coords, openingHours: near.openingHours, detourM: near.detourM, reason: `pause after about ${profile.pauseEveryMin} min of riding`, where: addressOf(near), openAtArrival: openAt(near) });
    breakMinutes += pauseMinutes;
    lastStopMin = minutesAt(legs, near.kmAlongRoute);
  }

  const ordered = placed().map((s) => ({ ...s, leg: legAt(s.kmAlongRoute) }));
  // Recompute arrival times in order, each stop adding its break to the ones after it.
  let extra = 0;
  for (const s of ordered) {
    s.eta = hhmm(departMin + minutesAt(legs, s.kmAlongRoute) + extra);
    if (date) s.openAtArrival = isOpenAt(s.openingHours, date, s.eta);
    if (s.openAtArrival === "closed") warnings.push(`${s.name} is closed at ${s.eta} on ${date} (${s.openingHours}); no open alternative nearby.`);
    extra += s.kind === "lunch" ? 45 : s.kind === "fuel" ? 10 : pauseMinutes;
  }
  return { date, fuelAtStartKm, stops: ordered, warnings };
}

export function formatStopPlan(plan: StopPlan, departure: string, totalRidingMinutes: number): string[] {
  const openWord = { open: "open at arrival", closed: "CLOSED at arrival", unknown: "hours not known" };
  const lines = plan.stops.flatMap((s) => [
    `  ${s.eta}  km ${String(s.kmAlongRoute).padStart(5)}  ${s.kind.padEnd(5)}  ${s.name}${s.where ? `, ${s.where}` : ""}${s.detourM > 100 ? ` (${s.detourM} m off the route)` : ""}`,
    `                        ${s.reason}; ${plan.date ? openWord[s.openAtArrival] : "hours not checked (no ride date)"}${s.openingHours ? ` [${s.openingHours}]` : ""}`,
  ]);
  const breaks = plan.stops.reduce((sum, s) => sum + (s.kind === "lunch" ? 45 : s.kind === "fuel" ? 10 : 15), 0);
  const [dh = 9, dm = 0] = departure.split(":").map(Number);
  const back = hhmm(dh * 60 + dm + totalRidingMinutes + breaks);
  return [
    `Stop plan (departure ${departure}, fuel at start ${plan.fuelAtStartKm} km):`,
    ...(lines.length ? lines : ["  no stops needed or none found"]),
    `  back around ${back} with ${breaks} min of breaks`,
    ...plan.warnings.map((w) => `  ! ${w}`),
  ];
}
