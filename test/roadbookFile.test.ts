import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodePolyline } from "../src/geometry.ts";
import { exportSavedRide, roadbookFilePath } from "../src/gpx.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { buildRoadbookFile, ROADBOOK_FORMAT, ROADBOOK_VERSION } from "../src/roadbookFile.ts";
import { Store } from "../src/store.ts";
import { effectiveLimit } from "../src/tools/trip.ts";
import { installFakeServices } from "./helpers/fakeServices.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.4, lon: 3.0 },
  B = { lat: 50.6, lon: 3.4 },
  C = { lat: 50.5, lon: 3.6 };
const leg1 = bentLine(A, B, 61, 0.02);
const leg2 = bentLine(B, C, 61, -0.02);
const shapes = [encodePolyline(leg1), encodePolyline(leg2)];
const legs = [
  { from: "Home", to: "Mont", fromCoords: "50.4,3", toCoords: "50.6,3.4" },
  { from: "Mont", to: "Home", fromCoords: "50.6,3.4", toCoords: "50.5,3.6" },
];
const FR = [{ country_code: "FR", state_code: "HDF" }];

/** A road edge, in the shape Valhalla returns it. */
const edge = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
  length: 20,
  speed_limit: 80,
  road_class: "secondary",
  density: 2,
  names: ["D 938", "Rue de la Gare"],
  begin_shape_index: from,
  end_shape_index: to,
  end_node: { admin_index: 0 },
  ...extra,
});

const tracing = (edgesOf: (leg: number) => unknown[]) => {
  let n = 0;
  return async (shape: string) => ({ shape, admins: FR, edges: edgesOf(n++) as any[] });
};

const input = (extra = {}) => ({ name: "Loop", description: "122 km", legs, shapes, ...extra });

test("roadbook file: the legs are one line, the shared point written once", async () => {
  const { file } = await buildRoadbookFile(
    input(),
    tracing(() => [edge(0, 60)]),
  );
  assert.equal(file.format, ROADBOOK_FORMAT);
  assert.equal(file.version, ROADBOOK_VERSION);
  assert.equal(file.name, "Loop");
  assert.equal(decodePolyline(file.line).length, 61 + 60);
});

test("roadbook file: limits refer to the written line, with each leg's offset", async () => {
  const { file } = await buildRoadbookFile(
    input(),
    tracing((leg) =>
      leg === 0 ? [edge(0, 30, { speed_limit: 50 }), edge(30, 60)] : [edge(0, 60, { speed_limit: 70 })],
    ),
  );
  assert.deepEqual(
    file.limits.map((l) => [l.from, l.to, l.kmh]),
    [
      [0, 30, 50],
      [30, 60, 80],
      [60, 120, 70],
    ],
  );
  const points = decodePolyline(file.line).length;
  for (const l of file.limits) assert.ok(l.from >= 0 && l.to < points && l.from < l.to);
});

test("roadbook file: the posted limit is posted, a default is marked assumed", async () => {
  const { file } = await buildRoadbookFile(
    input({ shapes: [shapes[0]!], legs: [legs[0]!] }),
    tracing(() => [
      edge(0, 20),
      edge(20, 40, { speed_limit: undefined, density: 2 }),
      edge(40, 60, { speed_limit: undefined, density: 8 }),
    ]),
  );
  assert.deepEqual(
    file.limits.map((l) => [l.kmh, l.posted]),
    [
      [80, true],
      [80, false],
      [50, false],
    ],
  );
});

test("roadbook file: edges of one road under one limit make one stretch, the road ref wins over the street name", async () => {
  const { file } = await buildRoadbookFile(
    input({ shapes: [shapes[0]!], legs: [legs[0]!] }),
    tracing(() => [edge(0, 20), edge(20, 40), edge(40, 60, { names: ["Rue Neuve"] })]),
  );
  assert.equal(file.limits.length, 2);
  assert.deepEqual(file.limits[0], { from: 0, to: 40, kmh: 80, posted: true, road: "D 938" });
  assert.equal(file.limits[1]!.road, "Rue Neuve");
});

test("roadbook file: an edge without shape indexes is skipped, an unnamed road has no road", async () => {
  const { file } = await buildRoadbookFile(
    input({ shapes: [shapes[0]!], legs: [legs[0]!] }),
    tracing(() => [edge(0, 30, { names: undefined }), { length: 1, speed_limit: 30 }, edge(30, 30)]),
  );
  assert.equal(file.limits.length, 1);
  assert.equal("road" in file.limits[0]!, false);
});

test("roadbook file: the stops are in riding order, the planned ones placed by their km", async () => {
  const { file } = await buildRoadbookFile(
    input({ stops: [{ lat: 50.55, lon: 3.2, label: "pause: Café", km: 10 }] }),
    tracing(() => [edge(0, 60, { length: 40 })]),
  );
  assert.deepEqual(
    file.stops.map((s) => s.name),
    ["Start: Home", "pause: Café", "1. Mont", "Finish: Home"],
  );
  assert.deepEqual([file.stops[0]!.lat, file.stops[0]!.lon], [50.4, 3]);
});

test("roadbook file: cameras give a place, a limit when there is one, and a direction only when it is both", async () => {
  const { file } = await buildRoadbookFile(
    input({
      cameras: [
        { coords: "50.5,3.1", limitKmh: 70, direction: "forward" },
        { coords: "50.51,3.2", limitKmh: "50;70", direction: "both" },
        { coords: "50.52,3.3", limitKmh: null, direction: null },
        { coords: "50.53,3.4", limitKmh: "none", direction: "90" },
        { coords: "50.54,3.5", limitKmh: 0, direction: "backward" },
      ],
    }),
    tracing(() => [edge(0, 60)]),
  );
  assert.deepEqual(
    file.cameras.map((c) => [c.kmh, c.direction]),
    [
      [70, null],
      [50, "both"],
      [null, null],
      [null, null],
      [null, null],
    ],
  );
  assert.deepEqual([file.cameras[0]!.lat, file.cameras[0]!.lon], [50.5, 3.1]);
});

test("roadbook file: a leg that cannot be traced keeps its routed line, has no limits, and is reported", async () => {
  const trace = async (shape: string) => {
    if (shape === shapes[1]) throw new Error("valhalla1.openstreetmap.de responded 429");
    return { shape, admins: FR, edges: [edge(0, 60)] as any[] };
  };
  const { file, limitsError } = await buildRoadbookFile(input(), trace);
  assert.match(limitsError ?? "", /leg 2: .*429/);
  assert.equal(decodePolyline(file.line).length, 61 + 60);
  assert.deepEqual(
    file.limits.map((l) => [l.from, l.to]),
    [[0, 60]],
  );
});

test("roadbook file: with every leg traced there is no error", async () => {
  const { limitsError } = await buildRoadbookFile(
    input(),
    tracing(() => [edge(0, 60)]),
  );
  assert.equal(limitsError, null);
});

test("effectiveLimit: posted, then the country default, then 50 in a built-up area", () => {
  assert.deepEqual(effectiveLimit({ speed_limit: 70, road_class: "secondary", density: 2 }, FR), {
    kmh: 70,
    posted: true,
    builtUp: false,
  });
  assert.deepEqual(effectiveLimit({ road_class: "secondary", density: 2, end_node: { admin_index: 0 } }, FR), {
    kmh: 80,
    posted: false,
    builtUp: false,
  });
  assert.deepEqual(effectiveLimit({ road_class: "secondary", density: 9, end_node: { admin_index: 0 } }, FR), {
    kmh: 50,
    posted: false,
    builtUp: true,
  });
  assert.equal(effectiveLimit({ road_class: "secondary" }, undefined).kmh, 80);
  assert.equal(effectiveLimit({ speed_limit: 0, road_class: "secondary" }, FR).posted, false);
});

test("export: a saved ride is written as a GPX and as a roadbook file next to it, through the real tracing path", async () => {
  const api = installFakeServices();
  void api;
  const store = new Store(":memory:");
  const id = store.saveRide({
    name: "Flandre loop",
    parentId: null,
    home: "Lille",
    rideDate: null,
    departure: null,
    distanceKm: 120,
    ridingMinutes: 150,
    waypoints: ["Lille", "Cassel"],
    roundTrip: true,
    speedLimits: {},
    preferences: DEFAULT_PREFERENCES,
    request: "a loop",
    itinerary: "text",
    mapsUrl: "m",
    cells: [],
    shapes,
    centerLat: 50.5,
    centerLon: 3.2,
    usage: null,
    extras: {
      gatheredAt: "now",
      daylight: null,
      cameras: [{ kmAlongRoute: 12, leg: 1, limitKmh: 70, direction: null, coords: "50.5,3.2" }],
      stops: {},
      errors: {},
    },
    legs: legs.map((l, i) => ({ seq: i + 1, ...l, distanceKm: 40, ridingMinutes: 45, mainRoads: [] })),
  });
  const dir = mkdtempSync(join(tmpdir(), "ride-export-"));
  const gpx = join(dir, "loop.gpx");
  const exported = await exportSavedRide(store, store.findRide(String(id))!, gpx);
  assert.equal(exported.path, gpx);
  assert.equal(exported.roadbookFile, join(dir, "loop.motoride.json"));
  assert.equal(roadbookFilePath(gpx), exported.roadbookFile);
  assert.equal(exported.limitsError, null);
  const file = JSON.parse(readFileSync(exported.roadbookFile, "utf8"));
  assert.equal(file.format, "motoride-roadbook");
  assert.equal(file.version, 1);
  assert.equal(file.name, "Flandre loop");
  assert.ok(decodePolyline(file.line).length > 100);
  assert.ok(file.limits.length >= 1);
  assert.deepEqual(file.cameras, [{ lat: 50.5, lon: 3.2, kmh: 70, direction: null }]);
  assert.ok(file.stops.length >= 3);
});
