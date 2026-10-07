import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGpx, describeStopsAt, routePointIndex } from "../src/gpx.ts";
import { formatExtras, formatRideDetail, formatRideLine, formatWeather, parseRating } from "../src/library.ts";
import { formatRideMarkdown } from "../src/markdown.ts";
import { Store } from "../src/store.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.4, lon: 3.0 },
  B = { lat: 50.6, lon: 3.4 },
  C = { lat: 50.5, lon: 3.6 };
const shapes = [
  encodePolyline(bentLine(A, B, 60, 0.02)),
  encodePolyline(bentLine(B, C, 60, -0.02)),
  encodePolyline(bentLine(C, A, 60, 0.01)),
];
const legs = [
  {
    seq: 1,
    from: "Start & <home>",
    to: "Mont",
    fromCoords: "50.4,3",
    toCoords: "50.6,3.4",
    distanceKm: 40,
    ridingMinutes: 45,
    mainRoads: ["D 1 (30 km)"],
  },
  {
    seq: 2,
    from: "Mont",
    to: "Val",
    fromCoords: "50.6,3.4",
    toCoords: "50.5,3.6",
    distanceKm: 30,
    ridingMinutes: 30,
    mainRoads: ["D 2 (25 km)"],
  },
  {
    seq: 3,
    from: "Val",
    to: "Start & <home>",
    fromCoords: "50.5,3.6",
    toCoords: "50.4,3",
    distanceKm: 50,
    ridingMinutes: 55,
    mainRoads: ["D 3 (40 km)"],
  },
];
const stop = { lat: 50.6, lon: 3.4, label: "pause: Café (10:05)", km: 40 };

test("GPX: valid structure, escaped names, attribution, stops as stages", () => {
  const gpx = buildGpx({ name: "Loop <test> & co", description: "d", legs, shapes, stops: [stop] });
  assert.match(gpx, /^<\?xml version="1.0"/);
  assert.match(gpx, /<name>Loop &lt;test&gt; &amp; co<\/name>/);
  assert.match(gpx, /openstreetmap\.org\/copyright/);
  assert.equal((gpx.match(/<trkseg>/g) ?? []).length, 3);
  assert.ok(gpx.includes("pause: Café (10:05)"));
  assert.ok((gpx.match(/<rtept /g) ?? []).length > legs.length + 1, "pass-through points added");
  const at = routePointIndex({ name: "x", description: "", legs, shapes, stops: [stop] });
  assert.equal(at.length, 1);
  assert.match(describeStopsAt(at)[0]!, /route point \d+ of \d+/);
});

function savedRide(store: Store) {
  const id = store.saveRide({
    name: "Test loop",
    parentId: null,
    home: "Home",
    rideDate: "2026-10-11",
    departure: "09:00",
    distanceKm: 120,
    ridingMinutes: 130,
    waypoints: ["Home", "Mont", "Val"],
    roundTrip: true,
    speedLimits: {
      openRoadPct: 75,
      untaggedOpenRoad: { pct: 10 },
      timeOnRoads70PlusPct: 60,
      timeAbove70EstimatedPct: 30,
      limit31to50: { pct: 18 },
      limit30OrLess: { pct: 1 },
      motorwayKm: 0,
    },
    preferences: { avoidMotorways: true, max30Pct: 3, max50Pct: 20 },
    request: "a loop",
    itinerary: "The itinerary text",
    mapsUrl: "https://maps.example/x",
    cells: ["1:1"],
    shapes,
    centerLat: 50.5,
    centerLon: 3.3,
    usage: null,
    extras: null,
    legs,
  });
  store.setExtras(id, {
    gatheredAt: "2026-10-04T10:00:00Z",
    daylight: { sunrise: "08:01", sunset: "19:06", firstLight: "07:29", lastLight: "19:39", daylightHours: 11.1 },
    cameras: [
      { kmAlongRoute: 4, leg: 1, limitKmh: 130, direction: "80", coords: "50.4,3" },
      { kmAlongRoute: 4, leg: 1, limitKmh: 130, direction: "260", coords: "50.4,3" },
      { kmAlongRoute: 62, leg: 2, limitKmh: null, direction: null, coords: "50.5,3.5" },
    ],
    stops: { fuel: [{ kmAlongRoute: 50, leg: 2, name: "Total", openingHours: "24/7", detourM: 20 }] },
    errors: {},
    weather: {
      forecastDate: "2026-10-11",
      gatheredAt: "2026-10-04T10:00:00Z",
      window: "09:00-12:00",
      points: [
        {
          label: "start",
          kmAlongRoute: 0,
          dry: true,
          maxRainProbPct: 10,
          totalRainMm: 0,
          minTempC: 9,
          maxTempC: 12,
          maxGustKmh: 20,
          sky: "partly cloudy",
        },
      ],
    },
    stopPlan: {
      date: "2026-10-11",
      fuelAtStartKm: 250,
      warnings: [],
      stops: [
        {
          kind: "pause",
          name: "Café",
          kmAlongRoute: 40,
          leg: 1,
          eta: "09:45",
          coords: "50.6,3.4",
          openingHours: "Su 08:00-12:00",
          detourM: 30,
          reason: "pause after about 70 min",
          where: "Rue X, Mont",
          openAtArrival: "open",
        },
      ],
    },
  });
  return store.findRide(String(id))!;
}

test("ride view: list line, road mix, daylight, weather, cameras, stop plan, legs", () => {
  const store = new Store(":memory:");
  const ride = savedRide(store);
  assert.match(formatRideLine(ride), /Test loop .* 120 km, 2h10/);
  const view = formatRideDetail(ride);
  for (const part of [
    "Road mix: 75% open road",
    "60% of time on 70+ roads",
    "Daylight on 2026-10-11",
    "Weather for 2026-10-11",
    "Fixed cameras (3)",
    "Stop plan",
    "Café, Rue X, Mont",
    "open at arrival",
    "Fuel stops: Total",
  ]) {
    assert.ok(view.includes(part), `view lacks: ${part}`);
  }
  assert.ok(formatExtras({ ...ride, extras: null }).some((l) => l.includes("not gathered yet")));
  store.close();
});

test("Markdown: sections, merged cameras, escaped tables, attribution", () => {
  const store = new Store(":memory:");
  const md = formatRideMarkdown(savedRide(store));
  for (const h of [
    "# Roadbook #1: Test loop",
    "## Road mix",
    "## Legs",
    "## Daylight",
    "## Weather",
    "## Stop plan",
    "## Fixed cameras (3)",
    "## Fuel stops",
    "## Itinerary as planned",
  ]) {
    assert.ok(md.includes(h), `markdown lacks: ${h}`);
  }
  assert.ok(md.includes("| 4 (x2) | 1 | 130 |"), "two cameras at one spot merged");
  assert.ok(md.includes("not tagged"));
  assert.ok(md.includes("© OpenStreetMap contributors"));
  store.close();
});

test("weather lines and rating parsing", () => {
  assert.deepEqual(formatWeather(null, "2026-10-11"), [
    "Weather: no forecast stored (date beyond the 16-day range at the last refresh)",
  ]);
  assert.deepEqual(formatWeather(null, null), []);
  assert.deepEqual(parseRating(["0", "never", "again"]), { rating: 0, notes: "never again" });
  assert.deepEqual(parseRating(["5"]), { rating: 5, notes: null });
  assert.throws(() => parseRating(["6"]), /0 \(never again\) to 5/);
});

test("escaping: share page quotes and Markdown cells hold against hostile names", async () => {
  const { escapeHtml } = await import("../src/share.ts");
  const { cell } = await import("../src/markdown.ts");
  assert.equal(escapeHtml(`" onmouseover="alert(1)' <b>&`), "&quot; onmouseover=&quot;alert(1)&#39; &lt;b&gt;&amp;");
  // A trailing backslash must not swallow the escape of the pipe after it.
  assert.equal(cell("D 9\\| x"), "D 9\\\\\\| x");
  assert.equal(cell("a|b"), "a\\|b");
});
