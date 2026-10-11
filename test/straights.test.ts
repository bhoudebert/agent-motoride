import assert from "node:assert/strict";
import { test } from "node:test";
import { describePreferences } from "../src/agent.ts";
import { checkItinerary } from "../src/checks.ts";
import { routeCells, straightRuns } from "../src/geometry.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import type { RegisteredRoute, RideContext } from "../src/session.ts";
import { Store } from "../src/store.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";
import { installFakeServices } from "./helpers/fakeServices.ts";

const api = installFakeServices();

const A = { lat: 50.44, lon: 3.37 };
// About 5.7 km north-west of A, like the D 953 from Saint-Amand to Orchies.
const B = { lat: 50.47, lon: 3.3 };

/** A road winding left and right of the line from a to b, `amplitude` degrees either side. */
function winding(a: typeof A, b: typeof A, waves: number, amplitude: number, n = 400) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return {
      lat: a.lat + (b.lat - a.lat) * t + amplitude * Math.sin(2 * Math.PI * waves * t),
      lon: a.lon + (b.lon - a.lon) * t,
    };
  });
}

test("straights: a straight road is one long straight; a bending road has none", () => {
  const [run, ...rest] = straightRuns(bentLine(A, B, 60));
  assert.equal(rest.length, 0);
  assert.ok(run!.km > 5.5 && run!.km < 6, `one straight of about 5.7 km, got ${run!.km}`);
  assert.deepEqual(straightRuns(winding(A, B, 12, 0.003)), [], "bends every 500 m, 300 m either side");
});

test("straights: a road that wanders within the corridor is still straight; a little more and it is not", () => {
  // 20 m either side of the line: still one straight road at the 50 m corridor.
  assert.equal(straightRuns(winding(A, B, 6, 0.00018)).length, 1);
  // 150 m either side: a gently bending road, cut into pieces too short to count.
  assert.deepEqual(straightRuns(winding(A, B, 3, 0.0014)), []);
});

test("straights: short ones do not count; a road ridden out and back is two straights", () => {
  const short = bentLine(A, { lat: 50.452, lon: 3.37 }, 20);
  assert.deepEqual(straightRuns(short), [], "1.3 km");
  const there = bentLine(A, { lat: 50.46, lon: 3.37 }, 20);
  assert.deepEqual(
    straightRuns([...there, ...there.slice(0, -1).reverse()]).map((r) => Math.round(r.km * 10) / 10),
    [2.2, 2.2],
    "out and back: two straights, not one of no length",
  );
});

test("straights: each routed trip reports them with the road they are on", async () => {
  const { computeTrip } = await import("../src/tools/trip.ts");
  // The fake router draws each leg as a long, very gentle arc: straight to a rider.
  const trip = await computeTrip({ waypoints: ["Lille", "Cassel"] });
  const straights = (
    trip.result.speedLimits as {
      longStraights: { km: number; pct: number; longest: Array<{ road: string; leg: number; km: number; at: string }> };
    }
  ).longStraights;
  assert.ok(straights.pct > 50, `mostly straight, got ${straights.pct}%`);
  assert.equal(straights.longest[0]!.road, "D 938", "named after the road it runs on");
  assert.equal(straights.longest[0]!.leg, 1);
  assert.match(straights.longest[0]!.at, /^\d+\.\d+,\d+\.\d+$/);
  assert.ok(straights.longest.length <= 4);
  api.edges = undefined;
});

function context(preferences = DEFAULT_PREFERENCES) {
  return {
    store: new Store(":memory:"),
    preferences,
    allowRepeat: false,
    lineage: new Set<number>(),
  } as unknown as RideContext;
}

function route(pct: number): RegisteredRoute {
  const shapes = [encodePolyline(bentLine(A, B, 30))];
  return {
    id: "r1",
    cells: routeCells(shapes),
    trip: {
      shapes,
      complete: true,
      result: {
        totalDistanceKm: 120,
        totalRidingMinutes: 150,
        usesMotorway: false,
        speedLimits: {
          limit31to50: { pct: 10 },
          limit30OrLess: { pct: 1 },
          longStraights: { km: pct * 1.2, pct, longest: [{ road: "D 953", leg: 1, km: 5.7, at: "50.44,3.37" }] },
        },
      },
    },
  } as unknown as RegisteredRoute;
}

test("straights: over the target, the rider is told, without a retry; a practical trip is not judged on them", () => {
  const limits = { maxDistanceKm: null, maxRidingMinutes: null };
  const over = checkItinerary(context(), route(32), "Loop, 120 km.", limits);
  assert.deepEqual(over.violations, [], "a target, not a limit");
  assert.deepEqual(over.notes, [
    "32% of the distance in long straights (longest 5.7 km on the D 953), over the 15% target",
  ]);
  assert.deepEqual(checkItinerary(context(), route(12), "Loop, 120 km.", limits).notes, []);
  assert.deepEqual(
    checkItinerary(context(), route(32), "Loop, 120 km, 32% on long straights.", limits).notes,
    [],
    "already said",
  );
  assert.deepEqual(
    checkItinerary(context({ ...DEFAULT_PREFERENCES, maxStraightPct: 40 }), route(32), "Loop, 120 km.", limits).notes,
    [],
    "the rider's own target",
  );
  const commute = checkItinerary(
    context({ ...DEFAULT_PREFERENCES, avoidMotorways: false }),
    route(32),
    "Trip, 120 km.",
    limits,
  );
  assert.deepEqual(commute.notes, []);
});

test("straights: the planner hears the rider's own target only when it differs from the default", () => {
  assert.doesNotMatch(describePreferences(DEFAULT_PREFERENCES), /straight/);
  assert.match(
    describePreferences({ ...DEFAULT_PREFERENCES, maxStraightPct: 5 }),
    /- Long straights \(2 km or more on one straight line\): aim for at most 5% of the distance\./,
  );
});
