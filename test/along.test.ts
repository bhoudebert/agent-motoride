import assert from "node:assert/strict";
import { test } from "node:test";
import { installFakeServices } from "./helpers/fakeServices.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const api = installFakeServices();
const { speedCamerasAlong, stopsAlong } = await import("../src/tools/along.ts");

const line = bentLine({ lat: 50.4, lon: 3.0 }, { lat: 50.8, lon: 3.6 }, 120, 0.01);
const shapes = [encodePolyline(line)];
const legs = [
  {
    from: "A",
    to: "B",
    fromCoords: "50.4,3",
    toCoords: "50.8,3.6",
    distanceKm: 60,
    ridingMinutes: 60,
    ridingTime: "1h00",
    avgSpeedKmh: 60,
    routerMinutes: 70,
    usesMotorway: false,
    mainRoads: [],
  },
];
const at = (i: number) => line[i]!;

test("cameras: located along the route, sorted by km, limit parsed", async () => {
  api.overpass = [
    { type: "node", id: 2, lat: at(90).lat, lon: at(90).lon, tags: { highway: "speed_camera", maxspeed: "90" } },
    {
      type: "node",
      id: 1,
      lat: at(10).lat,
      lon: at(10).lon,
      tags: { highway: "speed_camera", maxspeed: "50", direction: "80" },
    },
  ];
  const r = await speedCamerasAlong(shapes, legs);
  assert.equal(r.count, 2);
  assert.ok(r.cameras[0]!.kmAlongRoute < r.cameras[1]!.kmAlongRoute);
  assert.equal(r.cameras[0]!.limitKmh, 50);
  assert.equal(r.cameras[0]!.direction, "80");
});

test("stops: sorted by kind, spread along the route, named with hours and address", async () => {
  const fuel = Array.from({ length: 12 }, (_, i) => ({
    type: "node",
    id: 100 + i,
    lat: at(i * 9).lat,
    lon: at(i * 9).lon,
    tags: { amenity: "fuel", name: `F${i}` },
  }));
  api.overpass = [
    ...fuel,
    {
      type: "node",
      id: 200,
      lat: at(50).lat,
      lon: at(50).lon,
      tags: { amenity: "cafe", name: "Café du Coin", opening_hours: "Mo-Su 08:00-18:00", "addr:city": "Somewhere" },
    },
    { type: "way", id: 300, center: at(70), tags: { shop: "bakery", name: "Boulangerie" } },
  ];
  const r = (await stopsAlong(shapes, legs, ["fuel", "cafe", "bakery"], 400, 5)) as any;
  assert.equal(r.fuel.found, 12);
  assert.equal(r.fuel.stops.length, 5);
  const kms = r.fuel.stops.map((s: any) => s.kmAlongRoute);
  assert.deepEqual(
    kms,
    [...kms].sort((a: number, b: number) => a - b),
  );
  assert.ok(kms.at(-1) - kms[0] > 30, "picked across the route, not only at the start");
  assert.equal(r.cafe.stops[0].openingHours, "Mo-Su 08:00-18:00");
  assert.equal(r.cafe.stops[0].place, "Somewhere");
  assert.equal(r.bakery.stops[0].name, "Boulangerie");
});
