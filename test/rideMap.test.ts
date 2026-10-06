import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { routeCells } from "../src/geometry.ts";
import { writeRideMarkdown } from "../src/markdown.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { rideMapPng, rideMapSvg, townOf, writeRideMap } from "../src/rideMap.ts";
import { startShareServer } from "../src/share.ts";
import { type SavedRide, Store } from "../src/store.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.4, lon: 3.0 };
const B = { lat: 50.6, lon: 3.4 };
const Cc = { lat: 50.5, lon: 3.7 };

function ride(options: { named?: boolean } = {}): SavedRide {
  const named = options.named ?? true;
  const shapes = [
    encodePolyline(bentLine(A, B, 80, 0.03)),
    encodePolyline(bentLine(B, Cc, 80, -0.02)),
    encodePolyline(bentLine(Cc, A, 80, 0.01)),
  ];
  const store = new Store(":memory:");
  const end = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;
  const id = store.saveRide({
    name: "Monts & <vallées>",
    parentId: null,
    home: "Lille",
    rideDate: "2026-10-11",
    departure: "09:00",
    distanceKm: 120,
    ridingMinutes: 150,
    waypoints: ["A", "B", "C"],
    roundTrip: true,
    speedLimits: { openRoadPct: 77 },
    preferences: DEFAULT_PREFERENCES,
    request: "",
    itinerary: "",
    mapsUrl: "https://maps",
    cells: routeCells(shapes),
    shapes,
    centerLat: 50.5,
    centerLon: 3.3,
    usage: null,
    extras: {
      gatheredAt: "",
      daylight: null,
      errors: {},
      stops: {},
      cameras: [{ kmAlongRoute: 30, leg: 1, limitKmh: 70, direction: null, coords: "50.5,3.2" }],
      stopPlan: {
        date: null,
        fuelAtStartKm: 250,
        warnings: [],
        stops: [
          {
            kind: "pause",
            name: "Café du Mont",
            kmAlongRoute: 45,
            leg: 2,
            eta: "10:06",
            coords: "50.58,3.45",
            openingHours: null,
            detourM: 10,
            reason: "",
            where: "",
            openAtArrival: "unknown",
          },
        ],
      },
    },
    legs: [
      {
        seq: 1,
        from: named ? "Route Nationale, Coutiches" : end(A),
        to: named ? "Rue de Vendegies near Sommaing" : end(B),
        fromCoords: end(A),
        toCoords: end(B),
        distanceKm: 40,
        ridingMinutes: 50,
        mainRoads: [],
      },
      {
        seq: 2,
        from: "x",
        to: named ? "Grand-Rue near Beaufort" : end(Cc),
        fromCoords: end(B),
        toCoords: end(Cc),
        distanceKm: 40,
        ridingMinutes: 50,
        mainRoads: [],
      },
      {
        seq: 3,
        from: "x",
        to: named ? "Route Nationale, Coutiches" : end(A),
        fromCoords: end(Cc),
        toCoords: end(A),
        distanceKm: 40,
        ridingMinutes: 50,
        mainRoads: [],
      },
    ],
  });
  return store.findRide(String(id))!;
}

test("ride map: towns from leg ends, never coordinates or countries", () => {
  assert.equal(townOf("Rue de Vendegies near Sommaing"), "Sommaing");
  assert.equal(townOf("Route Nationale, Coutiches"), "Coutiches");
  assert.equal(townOf("Hainaut, Belgium"), "Hainaut");
  assert.equal(townOf("50.63391,3.05512"), null);
});

test("ride map: route, towns in order, stops, cameras with their limit, escaped figures", () => {
  const svg = rideMapSvg(ride());
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="\d+"/);
  assert.match(svg, /Coutiches · start and finish/);
  assert.ok(svg.indexOf("Sommaing") < svg.indexOf("Beaufort"), "towns in riding order");
  assert.match(svg, />70<\/text>/, "camera badge with its limit");
  assert.match(svg, />C<\/text>/, "a pause stop is a C");
  assert.match(svg, /10:06 Café du Mont/);
  assert.match(svg, /Monts &amp; &lt;vallées&gt;/, "names are escaped");
  assert.ok(svg.includes("120 KM   ·   2H30 RIDING   ·   77% OPEN ROAD"), "figures in the header");
  assert.doesNotMatch(svg, /\d\.\d{3,}/, "coordinates rounded to a tenth of a pixel");
  assert.equal((svg.match(/stroke-width="5" stroke-linejoin/g) ?? []).length, 3, "one coloured line per leg");
  assert.match(svg, /© OpenStreetMap contributors/);
});

test("ride map: an old ride with unnamed ends gets no coordinate labels", () => {
  const svg = rideMapSvg(ride({ named: false }));
  assert.match(svg, />Start and finish</);
  assert.doesNotMatch(svg, />50\.\d+,3\.\d+</);
});

test("ride map: a PNG with the bundled fonts, written next to a Markdown document", () => {
  const png = rideMapPng(ride());
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dir = mkdtempSync(join(tmpdir(), "ride-map-"));
  assert.equal(writeRideMap(ride(), join(dir, "loop.png")), join(dir, "loop.png"));
  const md = writeRideMarkdown(ride(), join(dir, "loop.md"));
  assert.ok(existsSync(join(dir, "loop.png")));
  assert.match(readFileSync(md, "utf8"), /!\[Map of the ride\]\(loop\.png\)/);
  assert.throws(() => rideMapSvg({ ...ride(), shapes: null }), /no stored route line/);
});

test("ride map: the phone page shows the picture", async () => {
  const picture = rideMapPng(ride());
  const shared = {
    name: "Loop",
    mapsUrl: "https://maps",
    itinerary: "text",
    picture,
    gpx: { name: "Loop", description: "", legs: [], shapes: [] },
  };
  const { server } = await startShareServer(() => shared, 0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.match(await (await fetch(`${base}/`)).text(), /<img src="\/map\.png"/);
    const image = await fetch(`${base}/map.png`);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await image.arrayBuffer()).length, picture.length);
  } finally {
    server.close();
  }
});
