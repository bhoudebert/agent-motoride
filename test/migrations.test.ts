import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { type Migration, MIGRATIONS, migrate } from "../src/migrations.ts";
import { Store } from "../src/store.ts";

const LATEST = MIGRATIONS.at(-1)!.version;
const file = () => join(mkdtempSync(join(tmpdir(), "ride-db-")), "library.db");
const versionOf = (db: DatabaseSync) =>
  (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const tableNames = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
    (t) => t.name,
  );

/** A library as created before versions: rides without the later columns, user_version 0. */
function legacyLibrary(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE rides (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL,
    parent_id INTEGER REFERENCES rides(id) ON DELETE SET NULL, home TEXT NOT NULL, ride_date TEXT, departure TEXT,
    distance_km REAL NOT NULL, riding_minutes INTEGER NOT NULL, waypoints TEXT NOT NULL, round_trip INTEGER NOT NULL,
    speed_limits TEXT NOT NULL, preferences TEXT NOT NULL, request TEXT NOT NULL, itinerary TEXT NOT NULL,
    maps_url TEXT NOT NULL, cells TEXT NOT NULL, center_lat REAL NOT NULL, center_lon REAL NOT NULL,
    rating INTEGER, notes TEXT)`);
  db.prepare(
    `INSERT INTO rides (name, created_at, home, distance_km, riding_minutes, waypoints, round_trip, speed_limits,
     preferences, request, itinerary, maps_url, cells, center_lat, center_lon, rating)
     VALUES ('Old loop', '2025-05-01', 'Lille', 120, 150, '[]', 1, '{}', '{}', '', '', '', '[]', 50.6, 3.1, 4)`,
  ).run();
  db.close();
}

test("migrations: a new library gets every step and needs no backup", () => {
  const path = file();
  new Store(path).close();
  const db = new DatabaseSync(path);
  assert.equal(versionOf(db), LATEST);
  assert.ok(tableNames(db).includes("rides"));
  db.close();
  assert.equal(existsSync(`${path}.bak-v0`), false);
});

test("migrations: a library from before versions keeps its rides, gains its columns, and is backed up first", () => {
  const path = file();
  legacyLibrary(path);
  const store = new Store(path);
  assert.equal(store.findRide("1")?.name, "Old loop");
  assert.equal(store.findRide("1")?.rating, 4);
  store.close();
  const db = new DatabaseSync(path);
  assert.equal(versionOf(db), LATEST);
  assert.ok(tableNames(db).includes("roadbooks"));
  db.close();
  const backup = new DatabaseSync(`${path}.bak-v0`);
  assert.equal(versionOf(backup), 0, "the copy is the library as it was");
  assert.equal((backup.prepare("SELECT name FROM rides").get() as { name: string }).name, "Old loop");
  assert.equal((backup.prepare("PRAGMA table_info(rides)").all() as unknown[]).length, 21, "without the new columns");
  backup.close();
});

test("migrations: each step runs once, however often the library is opened", () => {
  let runs = 0;
  const steps: Migration[] = [
    ...MIGRATIONS,
    { version: LATEST + 1, name: "count", up: (db) => (runs++, db.exec("CREATE TABLE counted (x)")) },
  ];
  const path = file();
  const db = new DatabaseSync(path);
  assert.deepEqual(migrate(db, path, steps), { from: 0, to: LATEST + 1, backup: null });
  assert.deepEqual(migrate(db, path, steps), { from: LATEST + 1, to: LATEST + 1, backup: null });
  assert.equal(runs, 1);
  db.close();
});

test("migrations: a step that fails midway leaves the library as it was", () => {
  const path = file();
  new Store(path).close();
  const db = new DatabaseSync(path);
  const failing: Migration = {
    version: LATEST + 1,
    name: "half done",
    up(target) {
      target.exec("CREATE TABLE half (x); INSERT INTO half VALUES (1); DELETE FROM rides;");
      throw new Error("disk full");
    },
  };
  assert.throws(
    () => migrate(db, path, [...MIGRATIONS, failing]),
    new RegExp(
      `migration ${LATEST + 1} \\(half done\\) failed and was undone: disk full\\. A copy from before is at .*bak-v${LATEST}`,
    ),
  );
  assert.equal(versionOf(db), LATEST);
  assert.equal(tableNames(db).includes("half"), false);
  assert.ok(existsSync(`${path}.bak-v${LATEST}`));
  db.close();
});

test("migrations: a table rebuild that breaks a reference is undone", () => {
  const path = file();
  new Store(path).close();
  const db = new DatabaseSync(path);
  const orphan: Migration = {
    version: LATEST + 1,
    name: "orphan leg",
    rebuild: true,
    up: (target) =>
      target.exec(`INSERT INTO legs (roadbook_id, seq, from_label, to_label, from_coords, to_coords, distance_km,
        riding_minutes, main_roads) VALUES (999, 1, 'a', 'b', '0,0', '0,0', 1, 1, '[]')`),
  };
  assert.throws(() => migrate(db, path, [...MIGRATIONS, orphan]), /1 broken reference\(s\)/);
  assert.equal((db.prepare("SELECT count(*) AS n FROM legs").get() as { n: number }).n, 0);
  assert.equal((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1, "back on");
  db.close();
});

test("migrations: a library newer than the app is refused, untouched", () => {
  const path = file();
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE future (x); PRAGMA user_version = ${LATEST + 5}`);
  db.close();
  assert.throws(() => new Store(path), new RegExp(`schema version ${LATEST + 5}, newer than this version of the app`));
  const after = new DatabaseSync(path);
  assert.deepEqual(tableNames(after), ["future"]);
  after.close();
});

/** A library at version 1, as saved rides were stored before roadbooks: one row mixing the design and the day. */
function versionOneLibrary(path: string): void {
  const db = new DatabaseSync(path);
  migrate(db, ":memory:", MIGRATIONS.slice(0, 1));
  const ride = db.prepare(
    `INSERT INTO rides (id, name, created_at, parent_id, home, ride_date, departure, distance_km, riding_minutes,
       waypoints, round_trip, speed_limits, preferences, request, itinerary, maps_url, cells, center_lat, center_lon,
       rating, notes, usage, shapes, extras)
     VALUES (?, ?, ?, ?, 'Lille', ?, '09:00', 120, 150, '["Lille","Cassel"]', 1, '{}', '{}', 'a loop', 'text', 'm',
       '[]', 50.7, 2.8, ?, ?, NULL, '["abc"]', ?)`,
  );
  const extras = JSON.stringify({
    gatheredAt: "2026-10-01T08:00:00Z",
    daylight: { sunrise: "07:50", sunset: "19:20", firstLight: null, lastLight: null, daylightHours: 11.5 },
    cameras: [{ kmAlongRoute: 12, leg: 1, limitKmh: 70, direction: null, coords: "50.7,2.9" }],
    stops: { fuel: [{ kmAlongRoute: 30, leg: 1, name: "Total", openingHours: "24/7", detourM: 50 }] },
    errors: { weather: "timeout" },
    stopPlan: { date: "2026-10-10", fuelAtStartKm: 250, warnings: [], stops: [] },
  });
  ride.run(1, "Flandre loop", "2026-10-01T08:00:00Z", null, "2026-10-10", null, null, extras);
  ride.run(2, "Flandre loop, Sunday", "2026-10-02T08:00:00Z", 1, "2026-10-11", 4, "lovely", null);
  ride.run(3, "Deleted later", "2026-10-03T08:00:00Z", null, null, null, null, null);
  db.exec("DELETE FROM rides WHERE id = 3");
  db.exec(`INSERT INTO segments (ride_id, seq, from_label, to_label, from_coords, to_coords, distance_km,
             riding_minutes, main_roads, rating, notes)
           VALUES (2, 1, 'Lille', 'Cassel', '50.6,3.0', '50.8,2.5', 60, 75, '["D 916"]', 5, 'great bends')`);
  const note = db.prepare(
    `INSERT INTO ride_notes (ride_id, created_at, text, rating, minutes_back, status) VALUES (?, ?, ?, NULL, 10, ?)`,
  );
  // Left at noon local time, so the day does not depend on the test machine's time zone.
  note.run(1, new Date(2026, 9, 10, 12).toISOString(), "awesome bends", "reviewed");
  note.run(2, new Date(2026, 9, 4, 12).toISOString(), "cobbles", "pending");
  db.exec(`INSERT INTO road_ratings (ride_id, note_id, created_at, road, rating, reason, approximate, cells)
           VALUES (1, 1, '2026-10-10T12:30:00Z', 'D 916', 5, 'awesome bends', 0, '[]')`);
  db.exec(`INSERT INTO runs (started_at, home, request, model, effort, usage, cost_usd, result, ride_id, error)
           VALUES ('2026-10-02T07:00:00Z', 'Lille', 'a loop', 'm', 'e', '{}', 0.1, NULL, 2, NULL)`);
  db.close();
}

test("migrations: each saved ride becomes a roadbook with the same id and its ride, and reads back unchanged", () => {
  const path = file();
  versionOneLibrary(path);
  const store = new Store(path);
  const first = store.findRide("1")!;
  assert.equal(first.name, "Flandre loop");
  assert.equal(first.rideDate, "2026-10-10");
  assert.equal(first.departure, "09:00");
  assert.equal(first.extras!.cameras[0]!.limitKmh, 70, "cameras kept");
  assert.equal(first.extras!.stops.fuel![0]!.name, "Total");
  assert.equal(first.extras!.daylight!.sunset, "19:20");
  assert.deepEqual(first.extras!.errors, { weather: "timeout" });
  assert.equal(first.extras!.stopPlan!.fuelAtStartKm, 250);
  const second = store.findRide("2")!;
  assert.equal(second.parentId, 1, "a copy is a variant of its origin");
  assert.equal(second.rating, 4);
  assert.equal(second.notes, "lovely");
  assert.equal(second.rideDate, "2026-10-11", "the planned ride is the one shown");
  assert.deepEqual([second.legs[0]!.rating, second.legs[0]!.notes], [5, "great bends"]);
  assert.deepEqual(
    store.listNotes({ all: true }).map((n) => [n.rideId, n.text, n.status]),
    [
      [2, "cobbles", "pending"],
      [1, "awesome bends", "reviewed"],
    ],
  );
  assert.equal(store.listRoadRatings()[0]!.rideId, 1);
  assert.equal(store.listRuns()[0]!.rideId, 2);

  const db = store.database;
  const day = (sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>;
  assert.deepEqual(
    day("SELECT roadbook_id, ride_date, status FROM rides ORDER BY id").map((r) => Object.values(r)),
    [
      [1, "2026-10-10", "ridden"],
      [2, "2026-10-11", "planned"],
      [2, "2026-10-04", "ridden"],
    ],
    "a note marks its day ridden; a note on another day gets a ride of its own",
  );
  const route = JSON.parse(String(day("SELECT route_extras FROM roadbooks WHERE id = 1")[0]!.route_extras));
  assert.deepEqual(Object.keys(route), ["cameras", "stops"], "route-bound extras on the roadbook");
  const dayExtras = JSON.parse(String(day("SELECT day_extras FROM rides WHERE roadbook_id = 1")[0]!.day_extras));
  assert.equal(dayExtras.cameras, undefined, "day-bound extras on the ride");
  assert.deepEqual(day("PRAGMA foreign_key_check"), []);
  assert.deepEqual(
    tableNames(db).filter((t) => ["segments", "rides_v2", "ride_notes_v2"].includes(t)),
    [],
    "old and temporary tables gone",
  );

  const next = store.saveRide({ ...second, name: "New", parentId: null, extras: null, legs: [] });
  assert.equal(next, 4, "the id of a deleted ride is never reused");
  store.close();
});
