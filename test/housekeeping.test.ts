import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  deleteRideQuestion,
  deleteRoadbookQuestion,
  leftoverFiles,
  rideOnDay,
  tidyLibrary,
} from "../src/housekeeping.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { type NewRide, Store } from "../src/store.ts";
import { emptyUsage } from "../src/usage.ts";

const ride = (overrides: Partial<NewRide> = {}): NewRide => ({
  name: "Avesnois loop",
  parentId: null,
  home: "Lille",
  rideDate: "2026-10-10",
  departure: "09:00",
  distanceKm: 150,
  ridingMinutes: 170,
  waypoints: ["Lille", "Avesnes"],
  roundTrip: true,
  speedLimits: {},
  preferences: DEFAULT_PREFERENCES,
  request: "a loop",
  itinerary: "text",
  mapsUrl: "m",
  cells: [],
  shapes: null,
  centerLat: 50.2,
  centerLon: 3.9,
  usage: null,
  extras: null,
  legs: [],
  ...overrides,
});

function library(store: Store): number {
  const id = store.saveRide(ride());
  store.planDay(id, "2026-10-17", "10:00");
  store.addNote({ rideId: id, text: "cobbles", rating: 0, minutesBack: 10, at: new Date(2026, 9, 10, 11) });
  store.addRoadRating({
    rideId: id,
    noteId: null,
    road: "D 962",
    rating: 0,
    reason: "cobbles",
    approximate: false,
    cells: [],
  });
  return id;
}

test("housekeeping: deleting a roadbook says what goes and what stays, and keeps road ratings", () => {
  const store = new Store(":memory:");
  const id = library(store);
  assert.equal(
    deleteRoadbookQuestion(store, store.findRide(String(id))!),
    'Delete roadbook #1 "Avesnois loop", its 2 rides and 1 note? Its 1 road rating stays: they are about the roads and keep steering plans.',
  );
  const lone = store.saveRide(ride({ name: "Lone", rideDate: null }));
  assert.equal(deleteRoadbookQuestion(store, store.findRide(String(lone))!), 'Delete roadbook #2 "Lone", its 1 ride?');
  store.deleteRide(id);
  assert.equal(store.listRideDays().total, 1, "its rides went with it");
  assert.equal(store.listNotes({ all: true }).length, 0, "and its notes");
  assert.deepEqual(
    store.listRoadRatings().map((r) => [r.road, r.rideId]),
    [["D 962", null]],
    "the road rating stays, unlinked",
  );
});

test("housekeeping: a ride found by roadbook and day, cancelled or deleted, the roadbook untouched", () => {
  const store = new Store(":memory:");
  const id = library(store);
  const found = rideOnDay(store, "Avesnois", "2026-10-10");
  assert.equal(
    deleteRideQuestion(found),
    'Delete the ride of 2026-10-10 (ridden) from roadbook #1 "Avesnois loop"? Its 1 note stays on the roadbook. The roadbook stays.',
  );
  assert.throws(() => rideOnDay(store, "1", "2026-10-11"), /has no ride on 2026-10-11/);
  assert.throws(() => rideOnDay(store, "1", "someday"), /"someday" is not a day/);
  assert.throws(() => rideOnDay(store, "9", "2026-10-10"), /No roadbook matches "9"/);

  store.cancelRide(rideOnDay(store, "1", "2026-10-17").ride.id);
  assert.equal(store.findRideOn(id, "2026-10-17")!.status, "cancelled");
  assert.equal(store.listRideDays().total, 2, "a cancelled ride stays in the list");
  store.deleteRideDay(found.ride.id);
  assert.equal(store.findRideOn(id, "2026-10-10"), undefined);
  assert.equal(store.listNotes({ all: true })[0]!.rideId, id, "its note stays on the roadbook");
  assert.ok(store.findRide(String(id)));
});

test("housekeeping: tidy drops expired lookups only, compacts, and lists other files without touching them", () => {
  const dir = mkdtempSync(join(tmpdir(), "ride-tidy-"));
  const path = join(dir, "library.db");
  const store = new Store(path);
  library(store);
  store.cacheSet("old", "getWeather", { big: "x".repeat(200_000) }, -1);
  store.cacheSet("fresh", "searchRoads", { ok: true }, 60_000);
  const run = store.startRun({
    home: "Lille",
    request: "",
    usage: emptyUsage("m", "e"),
    costUsd: 0,
    result: null,
    rideId: null,
    error: null,
  });
  store.addTrace(run, { scope: "main", kind: "tool", name: "searchRoads", payload: {} });
  writeFileSync(join(dir, "library.db.bak-v0"), "x".repeat(2_000_000));
  writeFileSync(join(dir, "notes.txt"), "not a library");
  const report = tidyLibrary(store);
  assert.match(report, /^Removed 1 expired lookup from the cache; traces and everything saved are kept\./);
  assert.match(report, /Library: \d+\.\d MB before, \d+\.\d MB now/);
  assert.match(report, /not touched[\s\S]*1\.9 MB {2}library\.db\.bak-v0$/);
  assert.doesNotMatch(report, /notes\.txt|library\.db-wal/);
  assert.deepEqual(store.cacheGet("fresh"), { ok: true });
  assert.equal(store.listTrace(run).length, 1, "traces kept");
  assert.equal(store.listRoadbooks().total, 1);
  assert.deepEqual(
    leftoverFiles(path).map((f) => f.name),
    ["library.db.bak-v0"],
  );
  store.close();
});

test("housekeeping: the terminal asks before deleting; without a terminal it needs --yes", () => {
  const dir = mkdtempSync(join(tmpdir(), "ride-delete-"));
  const path = join(dir, "library.db");
  const store = new Store(path);
  library(store);
  store.close();
  const rides = (...args: string[]) => {
    try {
      return execFileSync(process.execPath, ["src/rides.ts", ...args], {
        env: { PATH: process.env.PATH, RIDE_DB: path },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return String((error as { stderr: string }).stderr);
    }
  };
  assert.match(rides("delete", "roadbook", "1"), /Delete roadbook #1 [\s\S]*Not deleted: add --yes/);
  assert.match(rides("cancel", "1", "2026-10-17"), /^Cancelled the ride of 2026-10-17/);
  assert.match(rides("delete", "ride", "1", "2026-10-17", "--yes"), /^Deleted the ride of 2026-10-17 from roadbook #1/);
  assert.match(rides("delete", "1", "--yes"), /^Deleted roadbook #1 "Avesnois loop"/);
  assert.match(rides("roadbooks"), /^No saved roadbooks yet\./);
});
