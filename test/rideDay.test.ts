import assert from "node:assert/strict";
import { test } from "node:test";
import { pickRideForToday } from "../src/briefing.ts";
import { rideToBrief } from "../src/housekeeping.ts";
import { formatRideDetail, formatRideLine } from "../src/library.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { startLabel, startPoint } from "../src/start.ts";
import { type NewRide, Store } from "../src/store.ts";

const ride = (overrides: Partial<NewRide> = {}): NewRide => ({
  name: "Thuin Fagne",
  parentId: null,
  home: "COUTICHES",
  rideDate: "2099-05-02",
  departure: "09:00",
  distanceKm: 141,
  ridingMinutes: 135,
  waypoints: ["Thuin", "Chimay"],
  roundTrip: true,
  speedLimits: {},
  preferences: DEFAULT_PREFERENCES,
  request: "a loop from Thuin",
  itinerary: "text",
  mapsUrl: "m",
  cells: [],
  shapes: null,
  centerLat: 50.2,
  centerLon: 4.3,
  usage: null,
  extras: null,
  legs: [
    {
      seq: 1,
      from: "Thuin",
      to: "Rue de Falemprise near Silenrieux",
      fromCoords: "50.33933,4.28604",
      toCoords: "50.2,4.4",
      distanceKm: 70,
      ridingMinutes: 70,
      mainRoads: [],
    },
  ],
  ...overrides,
});

test("ride day: a loop started away from home is located and labelled where it starts", () => {
  const store = new Store(":memory:");
  const thuin = store.findRide(String(store.saveRide(ride())))!;
  assert.equal(startPoint(thuin), "50.33933,4.28604");
  assert.equal(startLabel(thuin), "Thuin");
  assert.match(formatRideLine(thuin), /\| {2}from Thuin {2}\|/);
  const label = (from: string) => startLabel({ ...thuin, legs: [{ ...thuin.legs[0]!, from }] });
  assert.equal(label("Thuin, Wallonia, Belgium"), "Thuin", "the place, not the region");
  assert.equal(label("Rue des Nobles near Thuin"), "Thuin");
  assert.equal(label("Route Nationale, Coutiches"), "Coutiches");
  assert.equal(startLabel({ ...thuin, legs: [] }), "COUTICHES", "no legs: the saved home");
  assert.equal(startPoint({ ...thuin, legs: [] }), "COUTICHES");
});

test("ride day: rating the day leaves the roads' rating alone, and shows with the roadbook's rides", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(ride());
  store.rateRide(id, 5, "superb bends");
  const day = store.findRideOn(id, "2099-05-02")!;
  assert.ok(store.rateRideDay(day.id, 2, "freezing, fog"));
  const after = store.findRide(String(id))!;
  assert.deepEqual([after.rating, after.notes], [5, "superb bends"], "the roadbook keeps its rating");
  assert.equal(store.findRideOn(id, "2099-05-02")!.status, "ridden");
  store.planDay(id, "2099-05-09", "10:00");
  const detail = formatRideDetail(store.findRide(String(id))!, store);
  assert.match(
    detail,
    /\nRides:\n {2}2099-05-09 10:00 {2}planned\n {2}2099-05-02 09:00 {2}ridden {2}★★☆☆☆ "freezing, fog"\n/,
  );
});

test("ride day: the briefing takes the soonest planned ride of any roadbook, or the one asked for", () => {
  const store = new Store(":memory:");
  const far = store.saveRide(ride({ name: "Far", rideDate: "2099-06-01" }));
  const soon = store.saveRide(ride({ name: "Soon", rideDate: "2099-05-02" }));
  store.planDay(far, "2099-05-01", "08:00");
  store.saveRide(ride({ name: "Past", rideDate: "2020-01-01" }));
  const next = pickRideForToday(store, "2099-04-01")!;
  assert.deepEqual([next.id, next.rideDate, next.departure], [far, "2099-05-01", "08:00"]);
  assert.equal(pickRideForToday(store, "2099-05-02")!.id, soon);
  assert.equal(pickRideForToday(store, "2100-01-01")!.name, "Past", "nothing planned: the latest roadbook");
  const asked = rideToBrief(store, "2099-04-01", String(far), "2099-06-01");
  assert.deepEqual([asked.id, asked.rideDate], [far, "2099-06-01"]);
  assert.throws(() => rideToBrief(store, "2099-04-01", String(far), "2099-06-02"), /has no ride on 2099-06-02/);
  assert.throws(() => rideToBrief(new Store(":memory:"), "2099-04-01"), /No saved roadbook to brief/);
});
