import assert from "node:assert/strict";
import { test } from "node:test";
import { planStops, type StopCandidate } from "../src/stops.ts";
import type { TripLeg } from "../src/tools/trip.ts";

const legs: TripLeg[] = [
  [77.1, 53],
  [13.1, 12],
  [13.2, 14],
  [13.1, 14],
  [71.3, 49],
].map(([d, m], i) => ({
  from: `a${i}`,
  to: `b${i}`,
  fromCoords: "50,3",
  toCoords: "50,3",
  distanceKm: d!,
  ridingMinutes: m!,
  ridingTime: "",
  avgSpeedKmh: 0,
  routerMinutes: 0,
  usesMotorway: false,
  mainRoads: [],
}));
const c = (km: number, name: string, openingHours: string | null = null): StopCandidate => ({
  kmAlongRoute: km,
  leg: 1,
  name,
  openingHours,
  detourM: 50,
  coords: "50,3",
});
const candidates = {
  fuel: [24, 52, 65, 78, 104, 114, 126, 162, 180].map((k) => c(k, `Fuel${k}`)),
  cafe: [0, 24, 52, 66, 77, 85, 117, 160, 180].map((k) => c(k, `Cafe${k}`)),
  bakery: [] as StopCandidate[],
  restaurant: [c(90, "Resto90"), c(118, "Resto118")],
};
const profile = { tankRangeKm: 220, reserveKm: 35, pauseEveryMin: 70, maxStintMin: 90, lunch: true };

test("fuel stop before the deadline, pause after the interval, breaks in the ETA", () => {
  const plan = planStops(legs, candidates, profile, "09:00");
  const kinds = plan.stops.map((s) => `${s.kind}@${s.kmAlongRoute}`);
  assert.deepEqual(kinds, ["pause@85", "fuel@180"]);
  assert.equal(plan.stops[1]!.eta > plan.stops[0]!.eta, true);
  assert.equal(plan.warnings.length, 0);
});

test("no fuel stop when the loop is inside the range", () => {
  const plan = planStops(legs, candidates, { ...profile, tankRangeKm: 338 }, "09:00");
  assert.equal(
    plan.stops.some((s) => s.kind === "fuel"),
    false,
  );
});

test("fuel at start shifts the first fuel stop; lunch warns when no restaurant is near midday", () => {
  const plan = planStops(legs, candidates, profile, "10:30", 100);
  assert.equal(plan.stops[0]!.kind, "fuel");
  assert.equal(plan.stops[0]!.kmAlongRoute, 65);
  assert.ok(plan.warnings.some((w) => w.includes("No restaurant")));
});

test("a café closed at arrival is skipped for an open one when the date is known", () => {
  const cafes = {
    ...candidates,
    cafe: [c(85, "ClosedSunday", "Mo-Sa 08:00-18:00"), c(88, "OpenSunday", "Su 08:00-14:00")],
  };
  const plan = planStops(legs, cafes, profile, "09:00", undefined, "2026-10-11");
  const pause = plan.stops.find((s) => s.kind === "pause")!;
  assert.equal(pause.name, "OpenSunday");
  assert.equal(pause.openAtArrival, "open");
});
