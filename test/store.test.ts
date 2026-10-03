import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../src/store.ts";
import { emptyUsage } from "../src/usage.ts";

const ride = (name: string) => ({
  name, parentId: null, home: "Lille", rideDate: "2026-10-10", departure: "09:00", distanceKm: 100, ridingMinutes: 120, waypoints: ["Lille", "Cassel"], roundTrip: true,
  speedLimits: {}, preferences: { avoidMotorways: true, max30Pct: 3, max50Pct: 20 }, request: "test", itinerary: "text", mapsUrl: "https://maps", cells: ["1:1"], shapes: ["abc"],
  centerLat: 50, centerLon: 3, usage: null, extras: null, legs: [{ seq: 1, from: "Lille", to: "Cassel", fromCoords: "50,3", toCoords: "50.8,2.5", distanceKm: 50, ridingMinutes: 60, mainRoads: ["D 938"] }, { seq: 2, from: "Cassel", to: "Lille", fromCoords: "50.8,2.5", toCoords: "50,3", distanceKm: 50, ridingMinutes: 60, mainRoads: [] }],
});

test("rides: save, find by id and name, rate, version, delete", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(ride("Monts de Flandre"));
  assert.equal(store.findRide(String(id))!.legs.length, 2);
  assert.equal(store.findRide("flandre")!.id, id);
  store.rateRide(id, 4, "nice");
  store.rateLeg(id, 2, 2, "gravel");
  const saved = store.findRide(String(id))!;
  assert.equal(saved.rating, 4);
  assert.equal(saved.legs[1]!.rating, 2);
  const v2 = store.saveRide({ ...ride("Monts de Flandre v2"), parentId: id });
  assert.equal(store.findRide(String(v2))!.parentId, id);
  assert.throws(() => store.findRide("monts"), /matches several/);
  store.deleteRide(v2);
  assert.equal(store.listRides().length, 1);
  store.close();
});

test("extras written in the wrong shape are repaired on read", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(ride("x"));
  store.setExtras(id, { gatheredAt: "now", daylight: null, cameras: [], errors: {}, stops: { fuel: { stops: [{ kmAlongRoute: 1, leg: 1, name: "F", openingHours: null, detourM: 10 }] } } as any });
  const stops = store.findRide(String(id))!.extras!.stops;
  assert.ok(Array.isArray(stops.fuel));
  assert.equal(stops.fuel![0]!.name, "F");
  store.close();
});

test("runs, trace, profile and cache", () => {
  const store = new Store(":memory:");
  const runId = store.startRun({ home: "Lille", request: "r", usage: emptyUsage("m", "n/a"), costUsd: null, result: null, rideId: null, error: null });
  store.addTrace(runId, { scope: "main", kind: "tool", name: "calculateTrip", ms: 5, payload: { input: {}, output: {} } });
  assert.equal(store.listTrace(runId).length, 1);
  assert.equal(store.findRun(runId)!.request, "r");
  assert.equal(store.getProfile().tankRangeKm, 250);
  store.setProfile({ tankRangeKm: 300 });
  assert.equal(store.getProfile().tankRangeKm, 300);
  store.cacheSet("k", "t", { a: 1 }, 1000);
  assert.deepEqual(store.cacheGet("k"), { a: 1 });
  store.cacheSet("old", "t", 1, -1);
  assert.equal(store.cacheGet("old"), undefined);
  store.close();
});
