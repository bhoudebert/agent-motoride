import assert from "node:assert/strict";
import { test } from "node:test";
import { routeCells } from "../src/geometry.ts";
import { Memory, recall } from "../src/memory.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { Store } from "../src/store.ts";
import { emptyUsage } from "../src/usage.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const NAMUR = { lat: 50.4669, lon: 4.8675 };
const DINANT = { lat: 50.2603, lon: 4.9123 };

function library() {
  const store = new Store(":memory:");
  const shapes = [
    encodePolyline(bentLine(NAMUR, DINANT, 60, 0.02)),
    encodePolyline(bentLine(DINANT, NAMUR, 60, -0.02)),
  ];
  const id = store.saveRide({
    name: "Meuse valley loop",
    parentId: null,
    home: "Namur",
    rideDate: "2026-10-04",
    departure: "09:00",
    distanceKm: 70,
    ridingMinutes: 90,
    waypoints: ["Namur", "Dinant"],
    roundTrip: true,
    speedLimits: {},
    preferences: DEFAULT_PREFERENCES,
    request: "a loop along the Meuse",
    itinerary: "",
    mapsUrl: "",
    cells: routeCells(shapes),
    shapes,
    centerLat: 50.36,
    centerLon: 4.89,
    usage: null,
    extras: null,
    legs: [
      {
        seq: 1,
        from: "Namur",
        to: "Dinant",
        fromCoords: "50.4669,4.8675",
        toCoords: "50.2603,4.9123",
        distanceKm: 35,
        ridingMinutes: 45,
        mainRoads: ["N92"],
      },
      {
        seq: 2,
        from: "Dinant",
        to: "Namur",
        fromCoords: "50.2603,4.9123",
        toCoords: "50.4669,4.8675",
        distanceKm: 35,
        ridingMinutes: 45,
        mainRoads: ["N947"],
      },
    ],
  });
  store.rateRide(id, 4, "lovely river roads");
  store.rateLeg(id, 2, 0, "cobbles through Godinne, never again");
  store.addRoadRating({
    rideId: id,
    noteId: null,
    road: "N92, Yvoir to Anhée",
    rating: 5,
    reason: "last 10 min awesome",
    approximate: false,
    cells: routeCells([encodePolyline(bentLine({ lat: 50.33, lon: 4.88 }, { lat: 50.29, lon: 4.9 }, 10))]),
  });
  // Two earlier sessions: a scout report and a road search, as the trace keeps them.
  const run = store.startRun({
    home: "Namur",
    request: "",
    usage: emptyUsage("m", "e"),
    costUsd: 0,
    result: null,
    rideId: null,
    error: null,
  });
  store.addTrace(run, {
    scope: "scout:Condroz",
    kind: "answer",
    name: "report",
    payload: {
      area: "Condroz (around Ciney)",
      found: false,
      waypoints: ["50.4669,4.8675", "50.29,5.09", "50.35,5.2", "50.4669,4.8675"],
      distanceKm: 140,
      openRoadPct: 52,
      pct50: 31,
      weather: "rain all afternoon",
      verdict: "too many villages on the N4",
    },
  });
  store.addTrace(run, {
    scope: "main",
    kind: "tool",
    name: "searchRoads",
    payload: {
      input: { location: "Ciney" },
      output: {
        center: "Ciney, Wallonia",
        areaMedianCurviness: 180,
        roads: [
          {
            ref: "N938",
            names: ["Route de Spontin"],
            lengthKm: 8,
            curvinessDegPerKm: 290,
            from: "50.31,5.05",
            to: "50.33,4.98",
          },
          { ref: "N97", lengthKm: 12, curvinessDegPerKm: 150, from: "50.29,5.1", to: "50.25,5.0" },
        ],
      },
    },
  });
  return { store, run };
}

test("memory: built from the library and the traces, then caught up incrementally", () => {
  const { store, run } = library();
  const memory = new Memory(store);
  assert.equal(memory.sync(), 2, "the scout report and the road search");
  assert.equal(memory.sync(), 0, "nothing new to read");
  store.addTrace(run, {
    scope: "scout:Ardennes",
    kind: "answer",
    name: "report",
    payload: { area: "Ardennes", found: true, waypoints: [] },
  });
  assert.equal(memory.sync(), 1);
});

test("memory: what is known around a place, with ages, stretches and roads ready to route", () => {
  const { store } = library();
  const known = recall(new Memory(store), { lat: 50.3, lon: 5.0 }, { radiusKm: 40 });
  assert.deepEqual(
    known.savedRides.map((r) => [r.name, r.rating]),
    [["Meuse valley loop", 4]],
  );
  assert.deepEqual(
    known.lovedStretches.map((s) => s.road),
    ["N92, Yvoir to Anhée"],
  );
  assert.equal(known.avoidedStretches.length, 1);
  assert.match(JSON.stringify(known.avoidedStretches[0]), /cobbles through Godinne/);
  const scout = known.scoutedAreas[0]!;
  assert.equal(scout.area, "Condroz (around Ciney)");
  assert.equal(scout.found, false);
  assert.equal(scout.openRoadPct, 52);
  assert.equal(scout.scoutedDaysAgo, 0);
  assert.deepEqual(
    known.knownWindingRoads.map((r) => [r.road, r.curvinessDegPerKm, r.from]),
    [
      ["N938", 290, "50.31,5.05"],
      ["N97", 150, "50.29,5.1"],
    ],
    "best first, with coordinates usable as waypoints",
  );
  assert.doesNotMatch(JSON.stringify(known), /rain all afternoon/, "weather is never remembered");
});

test("memory: far away is out of reach; words find things anywhere and cannot break the query", () => {
  const { store } = library();
  const memory = new Memory(store);
  const far = recall(memory, { lat: 45.18, lon: 5.72 }, { radiusKm: 40, query: "Godinne cobbles" });
  assert.equal(far.savedRides.length + far.scoutedAreas.length + far.knownWindingRoads.length, 0);
  assert.ok(
    far.wordMatches!.some((m) => m.kind === "leg"),
    "found by words, wherever it is",
  );
  assert.deepEqual(memory.words('N4" OR NEAR(x) *'), memory.words("N4 x"), "the text is words, never query syntax");
  assert.deepEqual(memory.words("   "), []);
  assert.ok(memory.words("dinant").length > 0, "case and accents folded");
});
