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
  const columns = (db.prepare("PRAGMA table_info(rides)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(["usage", "shapes", "extras"].every((c) => columns.includes(c)));
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
      target.exec(`INSERT INTO segments (ride_id, seq, from_label, to_label, from_coords, to_coords, distance_km,
        riding_minutes, main_roads) VALUES (999, 1, 'a', 'b', '0,0', '0,0', 1, 1, '[]')`),
  };
  assert.throws(() => migrate(db, path, [...MIGRATIONS, orphan]), /1 broken reference\(s\)/);
  assert.equal((db.prepare("SELECT count(*) AS n FROM segments").get() as { n: number }).n, 0);
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
