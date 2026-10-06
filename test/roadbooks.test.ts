import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRideDayPage, formatRoadbookPage } from "../src/library.ts";
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

test("roadbooks: rides listed latest date first, undated last, 20 per page, with the way to the next page", () => {
  const store = new Store(":memory:");
  const day = (i: number) =>
    `2099-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
  for (let i = 0; i < 44; i++) store.saveRide(ride({ name: `Loop ${i}`, rideDate: day(i) }));
  const undated = store.saveRide(ride({ name: "Someday", rideDate: null, departure: null }));
  const first = store.listRideDays();
  assert.deepEqual([first.page, first.pages, first.total, first.items.length], [1, 3, 45, 20]);
  assert.equal(first.items[0]!.rideDate, day(43), "latest date first");
  assert.equal(first.items[19]!.rideDate, day(24));
  const last = store.listRideDays(3);
  assert.equal(last.items.length, 5);
  assert.equal(last.items.at(-1)!.roadbookId, undated, "no date yet comes last");
  const next = (n: number) => `npm run rides -- rides --page ${n}`;
  const text = formatRideDayPage(first, next);
  assert.match(text, /^2099-02-16 Mon 09:00 {2}#44 {2}Loop 43 {2}\| {2}120 km, 2h30 {2}\| {2}planned$/m);
  assert.match(text, /\n\nPage 1 of 3 \(45 rides\)\. Next: npm run rides -- rides --page 2$/);
  assert.match(formatRideDayPage(last, next), /^no date yet {11}#45 {2}Someday .*\n\nPage 3 of 3 \(45 rides\)\.$/m);
  assert.equal(
    formatRideDayPage(store.listRideDays(4), next),
    "Page 4 does not exist: the last is page 3 (45 rides).",
    "past the last page: say so, no lines",
  );
});

test("roadbooks: listed newest first, with their ride count and next planned date", () => {
  const store = new Store(":memory:");
  assert.equal(formatRoadbookPage(store.listRoadbooks(), String), "No saved roadbooks yet.");
  assert.equal(formatRideDayPage(store.listRideDays(), String), "No rides yet.");
  const old = store.saveRide(ride({ name: "Old loop", rideDate: "2020-05-01" }));
  const fresh = store.saveRide(ride({ name: "Fresh loop", rideDate: "2099-05-01", parentId: old }));
  store.addNote({ rideId: fresh, text: "x", rating: null, minutesBack: 10, at: new Date(2099, 5, 1, 12) });
  const page = store.listRoadbooks();
  assert.deepEqual(
    page.items.map((i) => [i.roadbook.id, i.rides, i.nextDate]),
    [
      [fresh, 2, "2099-05-01"],
      [old, 1, null],
    ],
    "a past planned date is not next",
  );
  const text = formatRoadbookPage(page, (n) => `page ${n}`);
  assert.match(
    text,
    /^#2 {2}Fresh loop \(from #1\) {2}\| {2}120 km, 2h30, 48 km\/h {2}\| {2}2 rides, next 2099-05-01 {2}\| {2}unrated$/m,
  );
  assert.match(text, /^#1 {2}Old loop {2}\| {2}.* {2}\| {2}1 ride {2}\|/m);
  assert.match(text, /Page 1 of 1 \(2 roadbooks\)\.$/);
});
