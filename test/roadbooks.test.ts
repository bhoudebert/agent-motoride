import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { type NewRide, Store } from "../src/store.ts";

const ride = (overrides: Partial<NewRide> = {}): NewRide => ({
  name: "Flandre loop",
  parentId: null,
  home: "Lille",
  rideDate: "2026-10-10",
  departure: "09:00",
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
  shapes: null,
  centerLat: 50.7,
  centerLon: 2.8,
  usage: null,
  extras: null,
  legs: [],
  ...overrides,
});
const days = (store: Store) =>
  store.database
    .prepare("SELECT roadbook_id, ride_date, status FROM rides ORDER BY id")
    .all()
    .map((r) => Object.values(r));

test("roadbooks: a save is a roadbook and its ride; notes mark the ride of their day as ridden", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(ride());
  assert.deepEqual(days(store), [[id, "2026-10-10", "planned"]]);
  store.addNote({ rideId: id, text: "awesome", rating: 5, minutesBack: 10, at: new Date(2026, 9, 10, 11) });
  store.addNote({ rideId: id, text: "cold", rating: null, minutesBack: 10, at: new Date(2026, 9, 10, 15) });
  assert.deepEqual(days(store), [[id, "2026-10-10", "ridden"]], "one ride per day, however many notes");
  store.addNote({ rideId: id, text: "again", rating: null, minutesBack: 10, at: new Date(2026, 9, 17, 11) });
  assert.deepEqual(days(store).at(-1), [id, "2026-10-17", "ridden"]);
  assert.equal(store.findRide(String(id))!.rideDate, "2026-10-17", "the latest ride is shown when none is planned");
  assert.throws(() => store.addNote({ rideId: 99, text: "x", rating: null, minutesBack: 10 }), /No saved ride #99/);
  assert.equal(store.deleteRide(id), true);
  assert.deepEqual(days(store), [], "a roadbook's rides go with it");
});

test("roadbooks: extras split between the roadbook (cameras, stops) and the ride (the day), read back as one", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(ride({ rideDate: null, departure: null }));
  const extras = {
    gatheredAt: "now",
    daylight: null,
    cameras: [{ kmAlongRoute: 1, leg: 1, limitKmh: 50, direction: null, coords: "0,0" }],
    stops: { cafe: [] },
    errors: {},
    stopPlan: null,
  };
  store.setExtras(id, extras);
  assert.deepEqual(store.findRide(String(id))!.extras, extras);
  const route = store.database.prepare("SELECT route_extras FROM roadbooks").get() as { route_extras: string };
  const day = store.database.prepare("SELECT day_extras FROM rides").get() as { day_extras: string };
  assert.deepEqual(Object.keys(JSON.parse(route.route_extras)), ["cameras", "stops"]);
  assert.equal(JSON.parse(day.day_extras).cameras, undefined);
  store.database.exec("DELETE FROM rides");
  store.setExtras(id, extras);
  assert.deepEqual(days(store), [[id, null, "planned"]], "a roadbook without a ride gets an undated one");
  store.setExtras(99, extras);
  assert.equal(days(store).length, 1, "unknown roadbook: nothing written");
});
