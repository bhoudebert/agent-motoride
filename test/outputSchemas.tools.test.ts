// Every shared tool's real result, produced offline, must match the tool's outputSchema
// exactly: parsing succeeds and drops nothing (zod strips unknown keys, so equality with
// the raw JSON shows every key is modelled).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { finalText, installFakeServices, toolUse } from "./helpers/fakeServices.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

// The project .env holds a live key: a stand-in is set before anything reads it, and every call goes to the fakes.
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RIDE_MODEL = "claude-sonnet-5-5";
process.env.TOMTOM_API_KEY = "test-tomtom";
delete process.env.RIDE_SCOUTS;
const api = installFakeServices();
const { openRide } = await import("../src/agent.ts");
const { Store } = await import("../src/store.ts");
const { createToolDefinitions } = await import("../src/tools/index.ts");
const { DEFAULT_PREFERENCES } = await import("../src/preferences.ts");
const { routeCells } = await import("../src/geometry.ts");

const LILLE = { lat: 50.6339, lon: 3.0551 };
const CASSEL = { lat: 50.8011, lon: 2.4853 };
const line = bentLine(LILLE, CASSEL, 120, 0.05);
const at = (i: number) => line[i]!;
const DATE = "2026-10-10";

const store = new Store(":memory:");
const shapes = [encodePolyline(bentLine(LILLE, CASSEL, 60, 0.02)), encodePolyline(bentLine(CASSEL, LILLE, 60, -0.02))];
const rideId = store.saveRide({
  name: "Flandre loop",
  parentId: null,
  home: "Lille",
  rideDate: DATE,
  departure: "09:00",
  distanceKm: 90,
  ridingMinutes: 110,
  waypoints: ["Lille", "Cassel"],
  roundTrip: true,
  speedLimits: {},
  preferences: DEFAULT_PREFERENCES,
  request: "a loop to Cassel",
  itinerary: "",
  mapsUrl: "",
  cells: routeCells(shapes),
  shapes,
  centerLat: 50.7,
  centerLon: 2.8,
  usage: null,
  extras: {
    gatheredAt: "2026-10-01T08:00:00Z",
    daylight: { sunrise: "07:50", sunset: "19:00", firstLight: "07:20", lastLight: "19:30", daylightHours: 11.2 },
    cameras: [{ kmAlongRoute: 12, leg: 1, limitKmh: 50, direction: null, coords: "50.7,2.9" }],
    stops: { fuel: [{ kmAlongRoute: 30, leg: 1, name: "Total", openingHours: null, detourM: 100 }] },
    errors: {},
  },
  legs: [
    {
      seq: 1,
      from: "Lille",
      to: "Cassel",
      fromCoords: "50.6339,3.0551",
      toCoords: "50.8011,2.4853",
      distanceKm: 45,
      ridingMinutes: 55,
      mainRoads: ["D 933"],
    },
    {
      seq: 2,
      from: "Cassel",
      to: "Lille",
      fromCoords: "50.8011,2.4853",
      toCoords: "50.6339,3.0551",
      distanceKm: 45,
      ridingMinutes: 55,
      mainRoads: ["D 916"],
    },
  ],
});
store.rateRide(rideId, 4, "lovely");
store.rateLeg(rideId, 2, 0, "cobbles, never again");
store.addRoadRating({
  rideId,
  noteId: null,
  road: "D 933, Lille to Bailleul",
  rating: 5,
  reason: "great",
  approximate: false,
  cells: routeCells([encodePolyline(bentLine({ lat: 50.7, lon: 2.9 }, { lat: 50.72, lon: 2.8 }, 10))]),
  fromCoords: "50.7,2.9",
  toCoords: "50.72,2.8",
});

const quiet = console.log;
console.log = () => undefined;
const session = await openRide({ home: "Lille", store, now: new Date("2026-10-01T08:00:00") });
console.log = quiet;
const tools = new Map(createToolDefinitions(session.context, { scouts: true }).map((t) => [t.name, t]));

/** Run a tool as the MCP server does and require its result to match its outputSchema, key for key. */
async function call(name: string, input: unknown) {
  const tool = tools.get(name);
  assert.ok(tool, `${name} is a shared tool`);
  const raw = await tool.run(tool.inputSchema.parse(input));
  const data = JSON.parse(raw);
  const parsed = tool.outputSchema.parse(data);
  assert.deepEqual(parsed, data, `${name}: the schema leaves out keys of the real result`);
  return data;
}

const waypoints = ["Lille", "Cassel", "Mont des Cats"];
let routeId = "";

test("every shared tool declares an outputSchema that rejects a foreign object", () => {
  assert.equal(tools.size, 13);
  for (const tool of tools.values()) {
    assert.equal(tool.outputSchema.safeParse({ unrelated: true }).success, false, tool.name);
  }
});

test("calculateTrip and importRoute", async () => {
  const trip = await call("calculateTrip", { waypoints, roundTrip: true });
  routeId = trip.routeId;
  assert.ok(Array.isArray(trip.legs) && trip.speedLimits.openRoadPct !== undefined);
  assert.equal(trip.motorwaysPermitted, false);

  const dir = mkdtempSync(join(tmpdir(), "outputschemas-"));
  const file = join(dir, "loop.gpx");
  const points = bentLine(LILLE, CASSEL, 40, 0.02);
  writeFileSync(
    file,
    `<?xml version="1.0"?><gpx><trk><name>Col</name><trkseg>${points
      .map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"/>`)
      .join("")}</trkseg></trk></gpx>`,
  );
  const imported = await call("importRoute", { file });
  assert.equal(imported.file.name, "Col");
});

test("calculateTrip when the speed-limit lookup fails", async () => {
  // Valhalla's trace endpoint failing leaves the router's own times and a message in speedLimits.
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    if (String(input).includes("trace_attributes")) return new Response("down", { status: 500 });
    return real(input, init);
  }) as typeof fetch;
  try {
    const trip = await call("calculateTrip", { waypoints: ["Lille", "Cassel"], roundTrip: false });
    assert.equal(typeof trip.speedLimits.unavailable, "string");
  } finally {
    globalThis.fetch = real;
  }
});

test("weather, daylight, traffic", async () => {
  const weather = await call("getWeather", { location: "Lille", date: DATE });
  assert.ok(weather.hours.length > 0);
  await call("getDaylight", { location: "Lille", date: DATE });
  const traffic = await call("getTraffic", { waypoints: ["Lille", "Cassel"], departAt: `${DATE}T09:00:00` });
  assert.equal(traffic.available, true);
  delete process.env.TOMTOM_API_KEY;
  const none = await call("getTraffic", { waypoints: ["Lille", "Cassel"], departAt: `${DATE}T10:00:00` });
  assert.equal(none.available, false);
});

test("getWeather when the models disagree", async () => {
  api.forecast = { icon_seamless: { precipitation: Array.from({ length: 24 }, () => 3) } };
  try {
    const weather = await call("getWeather", { location: "Cassel", date: DATE, fromHour: 9, toHour: 12 });
    assert.equal(weather.summary.modelsDisagree, true);
  } finally {
    api.forecast = undefined;
  }
});

test("searchRoads and recallArea (nothing learnt yet, then roads and a scout's verdict)", async () => {
  const before = await call("recallArea", { location: "Lille", radiusKm: 150 });
  assert.equal(before.savedRoadbooks.length, 1);
  assert.ok(before.lovedStretches.length > 0 && before.avoidedStretches.length > 0);

  api.overpass = [
    { type: "way", id: 1, tags: { highway: "secondary", ref: "D 933", name: "Route de Cassel" }, geometry: line },
    {
      type: "node",
      id: 2,
      lat: at(40).lat,
      lon: at(40).lon,
      tags: { mountain_pass: "yes", name: "Mont des Cats", ele: "164" },
    },
    {
      type: "node",
      id: 3,
      lat: at(50).lat,
      lon: at(50).lon,
      tags: { mountain_pass: "yes", name: "Col sans altitude" },
    },
  ];
  const roads = await call("searchRoads", { location: "Cassel" });
  assert.equal(roads.roads.length, 1);

  // A scout reports on an area (scripted model, fake services), which the memory keeps.
  api.script = [
    toolUse("calculateTrip", { waypoints, roundTrip: true }),
    finalText(
      JSON.stringify({
        area: "Flandre",
        found: true,
        routeId: "flandre-r1",
        waypoints: ["50.63,3.05", "50.80,2.48", "50.78,2.66"],
        distanceKm: 135,
        ridingMinutes: 110,
        openRoadPct: 70,
        pct50: 20,
        pct30: 1,
        weather: "dry",
        verdict: "good",
      }),
    ),
  ];
  const scouted = await call("scoutAreas", {
    areas: [{ name: "Flandre", location: "Cassel" }],
    rideDate: DATE,
    departure: "09:00",
    maxDistanceKm: 250,
    maxRidingMinutes: 180,
    constraints: "dry",
  });
  assert.equal(scouted.reports[0].routeId, "flandre-r1");
  assert.equal(typeof scouted.reports[0].longStraightsPct, "number");

  const after = await call("recallArea", { location: "Lille", radiusKm: 150, query: "Flandre D 933" });
  assert.ok(after.scoutedAreas.length > 0, "the scout's verdict is remembered");
  assert.ok(after.knownWindingRoads.length > 0, "the road search is remembered");
  assert.ok(after.wordMatches.length > 0);
});

test("scoutAreas when scouts cannot run, and when the client runs them", async () => {
  process.env.RIDE_SCOUTS = "0";
  try {
    const off = await call("scoutAreas", {
      areas: [{ name: "Vercors", location: "Grenoble" }],
      rideDate: DATE,
      departure: "09:00",
      maxDistanceKm: null,
      maxRidingMinutes: null,
      constraints: "twisty",
    });
    assert.deepEqual(off.reports, []);
  } finally {
    delete process.env.RIDE_SCOUTS;
  }
  // What rideServer answers when API scouts are off: briefs for the client's own subagents.
  const tool = tools.get("scoutAreas")!;
  const clientShape = {
    reports: [],
    notes: ["scout them yourself"],
    briefs: [{ area: "Flandre", brief: "Area to scout: Flandre." }],
  };
  assert.deepEqual(tool.outputSchema.parse(clientShape), clientShape);
});

test("along the route: cameras, stops, plan, conditions, listSavedRoadbooks", async () => {
  api.overpass = [
    {
      type: "node",
      id: 1,
      lat: at(10).lat,
      lon: at(10).lon,
      tags: { highway: "speed_camera", maxspeed: "50", direction: "80" },
    },
    { type: "node", id: 2, lat: at(90).lat, lon: at(90).lon, tags: { highway: "speed_camera", maxspeed: "signals" } },
  ];
  const cameras = await call("getSpeedCameras", { routeId });
  assert.equal(cameras.count, 2);

  api.overpass = [
    {
      type: "node",
      id: 10,
      lat: at(20).lat,
      lon: at(20).lon,
      tags: { amenity: "fuel", name: "Total", brand: "Total", opening_hours: "24/7" },
    },
    { type: "node", id: 11, lat: at(60).lat, lon: at(60).lon, tags: { amenity: "fuel" } },
    {
      type: "node",
      id: 12,
      lat: at(40).lat,
      lon: at(40).lon,
      tags: {
        amenity: "cafe",
        name: "Café du Mont",
        "addr:city": "Cassel",
        "addr:street": "Rue Haute",
        opening_hours: "Mo-Su 08:00-19:00",
      },
    },
    { type: "node", id: 13, lat: at(70).lat, lon: at(70).lon, tags: { shop: "bakery", name: "Boulangerie" } },
    { type: "node", id: 14, lat: at(50).lat, lon: at(50).lon, tags: { amenity: "restaurant", name: "Estaminet" } },
  ];
  const found = await call("findStops", { routeId, kinds: ["fuel", "cafe", "restaurant", "bakery"] });
  assert.ok(found.fuel.found > 0);
  await call("findStops", { routeId });

  const plan = await call("planStops", { routeId, departure: "09:00", date: DATE });
  assert.ok(plan.stops.length > 0);
  await call("planStops", { routeId, departure: "9:30" });

  const conditions = await call("checkConditions", { routeId, date: DATE, departure: "09:00" });
  assert.equal(conditions.windChecked, true);
  // Beyond the forecast range: glare only, same shape.
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    if (host === "api.open-meteo.com") return new Response("out of range", { status: 400 });
    return real(input, init);
  }) as typeof fetch;
  try {
    const far = await call("checkConditions", { routeId, date: "2026-12-24", departure: "15:30" });
    assert.equal(far.windChecked, false);
  } finally {
    globalThis.fetch = real;
  }

  const saved = await call("listSavedRoadbooks", {});
  assert.equal(saved.count, 1);
  assert.equal(saved.roadbooks[0].stops.fuel[0], "Total (km 30)");
  assert.ok(saved.roadRatings.length > 0);
});

test("a call repeated three times returns the earlier result with repeatedCall and repeatNote beside it", async () => {
  const inputs: Array<[string, unknown]> = [
    ["listSavedRoadbooks", { radiusKm: 100 }],
    ["getWeather", { location: "Lille", date: DATE, fromHour: 10, toHour: 14 }],
    ["getDaylight", { location: "Cassel", date: DATE }],
    ["getTraffic", { waypoints: ["Lille", "Cassel"], departAt: `${DATE}T11:00:00` }],
    ["searchRoads", { location: "Cassel", radiusKm: 10 }],
    ["getSpeedCameras", { routeId }],
    ["findStops", { routeId, kinds: ["fuel"] }],
    ["checkConditions", { routeId, date: DATE, departure: "10:00" }],
  ];
  for (const [name, input] of inputs) {
    // The fake Overpass answers every query with the same elements: only roads for the road search.
    if (name === "searchRoads")
      api.overpass = [{ type: "way", id: 1, tags: { highway: "tertiary", ref: "D 11" }, geometry: line }];
    const first = await call(name, input);
    await call(name, input);
    const third = await call(name, input);
    assert.ok(third.repeatedCall >= 3, name);
    assert.match(third.repeatNote, new RegExp(`do not call ${name} with this input again`));
    // The tool's own note, when it has one, survives the repeat notice.
    const { repeatedCall: _r, repeatNote: _n, ...rest } = third;
    assert.deepEqual(rest, first, name);
  }
});
