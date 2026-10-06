import assert from "node:assert/strict";
import { test } from "node:test";
import { checkItinerary, correctionMessage, parseLimits } from "../src/checks.ts";
import { routeCells } from "../src/geometry.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import type { RegisteredRoute, RideContext } from "../src/session.ts";
import { Store } from "../src/store.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

test("limits: caps read from the rider's words, wishes ignored", () => {
  const cases: Array<[string, number | null, number | null]> = [
    ["This Saturday, no rain, under 250 km, winding roads", 250, null],
    ["Roadtrip moto this Saturday, no rain, <250km, winding roads", 250, null],
    ["Tomorrow afternoon, leave at 14:00, at most two hours of riding, nice bends", null, 120],
    ["A 600 km loop in under two hours of riding", null, 120],
    ["2h max, 180 km max", 180, 120],
    ["Something short, 90 minutes max", null, 90],
    ["no more than 1.5 hours", null, 90],
    ["Saturday, about 150 km of open roads, no rain", null, null],
    ["Get me to Rue de la Loi, Brussels, by 9:00 next Monday", null, null],
  ];
  for (const [request, km, minutes] of cases) {
    assert.deepEqual(parseLimits(request), { maxDistanceKm: km, maxRidingMinutes: minutes }, request);
  }
});

function setup(options: { avoidMotorways?: boolean } = {}) {
  const store = new Store(":memory:");
  const shapes = [encodePolyline(bentLine({ lat: 50.4, lon: 3 }, { lat: 50.6, lon: 3.3 }, 80, 0.02))];
  const route = {
    id: "r1",
    cells: routeCells(shapes),
    trip: {
      shapes,
      complete: true,
      result: { totalDistanceKm: 214, totalRidingMinutes: 150, totalRidingTime: "2h30", usesMotorway: true },
    },
  } as unknown as RegisteredRoute;
  const context = {
    store,
    preferences: { ...DEFAULT_PREFERENCES, avoidMotorways: options.avoidMotorways ?? true },
    allowRepeat: false,
    lineage: new Set<number>(),
  } as unknown as RideContext;
  return { store, route, context };
}

test("checks: caps, motorways and stated distance; a clean itinerary passes", () => {
  const { route, context } = setup();
  const failed = checkItinerary(context, route, "Loop of 200 km through the hills.", {
    maxDistanceKm: 200,
    maxRidingMinutes: 120,
  });
  assert.deepEqual(failed.violations, [
    "distance: routed 214 km, over the rider's 200 km limit",
    "riding time: 2h30 estimated, over the rider's 120 minutes limit",
    "motorways: the route uses a motorway, and the rider forbids them",
    "figures: the answer does not state the routed distance, 214 km",
  ]);
  assert.equal(failed.acknowledged, false);

  const ok = checkItinerary(setup({ avoidMotorways: false }).context, route, "Loop, 214 km, 2h30.", {
    maxDistanceKm: 250,
    maxRidingMinutes: null,
  });
  assert.deepEqual(ok.violations, []);
});

test("checks: an answer owning up to a missed limit is acknowledged", () => {
  const { route, context } = setup({ avoidMotorways: false });
  const result = checkItinerary(
    context,
    route,
    "No loop fits under 200 km. Closest option: 214 km, 14 km over the limit.",
    { maxDistanceKm: 200, maxRidingMinutes: null },
  );
  assert.equal(result.violations.length, 1);
  assert.equal(result.acknowledged, true);
});

test("checks: repeats of saved rides and roads rated never again", () => {
  const { store, route, context } = setup({ avoidMotorways: false });
  const id = store.saveRide({
    name: "Old loop",
    parentId: null,
    home: "Lille",
    rideDate: null,
    departure: null,
    distanceKm: 214,
    ridingMinutes: 150,
    waypoints: [],
    roundTrip: true,
    speedLimits: {},
    preferences: DEFAULT_PREFERENCES,
    request: "",
    itinerary: "",
    mapsUrl: "",
    cells: route.cells,
    shapes: route.trip.shapes,
    centerLat: 50.5,
    centerLon: 3.1,
    usage: null,
    extras: null,
    legs: [
      {
        seq: 1,
        from: "A",
        to: "B",
        fromCoords: "50.4,3",
        toCoords: "50.6,3.3",
        distanceKm: 214,
        ridingMinutes: 150,
        mainRoads: [],
      },
    ],
  });
  store.rateRide(id, 0, "never again");
  const { violations } = checkItinerary(context, route, "Loop, 214 km.", {
    maxDistanceKm: null,
    maxRidingMinutes: null,
  });
  assert.match(violations[0]!, /^repeat: 100% of the roads of saved ride #1 "Old loop"/);
  assert.match(violations[1]!, /^rated roads: 100% on roads the rider rated 0 or 1/);
  assert.match(correctionMessage(violations), /^\[Automatic check by code, not from the rider\./);
});

test("checks: a leisure ride mostly on fast expressways goes back; a practical trip does not", () => {
  const { route } = setup();
  const fast = {
    ...route,
    trip: {
      ...route.trip,
      result: {
        ...route.trip.result,
        usesMotorway: false,
        speedLimits: { fastExpressway: { km: 90, pct: 42, longest: [{ road: "N 41" }, { road: "N 17" }] } },
      },
    },
  } as unknown as RegisteredRoute;
  const limits = { maxDistanceKm: null, maxRidingMinutes: null };
  const leisure = checkItinerary(setup().context, fast, "Loop, 214 km.", limits);
  assert.deepEqual(leisure.violations, [
    "fast expressway: 42% of the ride on roads limited to 100 km/h or more that are not motorways (N 41, N 17); route around them for a leisure ride, or say why not",
  ]);
  const practical = checkItinerary(setup({ avoidMotorways: false }).context, fast, "Trip, 214 km.", limits);
  assert.deepEqual(practical.violations, []);
});
