import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

/**
 * Versioned schema of the library (ADR 0022). The version lives in the file
 * (PRAGMA user_version); each step runs once, in order, in a transaction that
 * also bumps the version, after a backup of the file. Never edit a step once
 * released: add the next one.
 */
export interface Migration {
  version: number;
  name: string;
  /** Rebuilds tables: foreign keys are off during the step and checked before commit. */
  rebuild?: boolean;
  up(db: DatabaseSync): void;
}

// The schema as it stood before versioning. IF NOT EXISTS, so a library
// created before versions (user_version 0) passes through it unchanged.
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS rides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  parent_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
  home TEXT NOT NULL,
  ride_date TEXT,
  departure TEXT,
  distance_km REAL NOT NULL,
  riding_minutes INTEGER NOT NULL,
  waypoints TEXT NOT NULL,
  round_trip INTEGER NOT NULL,
  speed_limits TEXT NOT NULL,
  preferences TEXT NOT NULL,
  request TEXT NOT NULL,
  itinerary TEXT NOT NULL,
  maps_url TEXT NOT NULL,
  cells TEXT NOT NULL,
  center_lat REAL NOT NULL,
  center_lon REAL NOT NULL,
  rating INTEGER,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  from_label TEXT NOT NULL,
  to_label TEXT NOT NULL,
  from_coords TEXT NOT NULL,
  to_coords TEXT NOT NULL,
  distance_km REAL NOT NULL,
  riding_minutes INTEGER NOT NULL,
  main_roads TEXT NOT NULL,
  rating INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS segments_ride ON segments(ride_id, seq);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  home TEXT NOT NULL,
  request TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  usage TEXT NOT NULL,
  cost_usd REAL,
  result TEXT,
  ride_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  ms INTEGER,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trace_run ON trace(run_id, id);
CREATE TABLE IF NOT EXISTS profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ride_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  text TEXT NOT NULL,
  rating INTEGER,
  minutes_back INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  placement TEXT
);
CREATE INDEX IF NOT EXISTS ride_notes_ride ON ride_notes(ride_id, id);
CREATE TABLE IF NOT EXISTS road_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
  note_id INTEGER REFERENCES ride_notes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  road TEXT NOT NULL,
  rating INTEGER NOT NULL,
  reason TEXT,
  approximate INTEGER NOT NULL,
  cells TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_cache (
  key TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  output TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "schema before versioning",
    up(db) {
      db.exec(SCHEMA_V1);
      // Libraries created before usage tracking, route lines and extras lack these columns.
      const columns = db.prepare("PRAGMA table_info(rides)").all() as Array<{ name: string }>;
      for (const name of ["usage", "shapes", "extras"]) {
        if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE rides ADD COLUMN ${name} TEXT`);
      }
    },
  },
  {
    version: 2,
    name: "roadbooks and rides",
    rebuild: true,
    up: roadbooksAndRides,
  },
];

// Frozen with step 2: later code may change, this must not.
const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Step 2 (ADR 0023): each saved ride becomes a roadbook with the same id (the
 * design, with route-bound extras) and one ride (the day: date, departure,
 * day-bound extras). Legs, notes, road ratings and runs point to the roadbook;
 * a note also points to the ride of its day, created as ridden when missing.
 */
function roadbooksAndRides(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE roadbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  variant_of INTEGER REFERENCES roadbooks(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  home TEXT NOT NULL,
  distance_km REAL NOT NULL,
  riding_minutes INTEGER NOT NULL,
  waypoints TEXT NOT NULL,
  round_trip INTEGER NOT NULL,
  speed_limits TEXT NOT NULL,
  preferences TEXT NOT NULL,
  request TEXT NOT NULL,
  itinerary TEXT NOT NULL,
  maps_url TEXT NOT NULL,
  cells TEXT NOT NULL,
  center_lat REAL NOT NULL,
  center_lon REAL NOT NULL,
  shapes TEXT,
  usage TEXT,
  route_extras TEXT,
  rating INTEGER,
  notes TEXT
);
CREATE TABLE roadbook_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadbook_id INTEGER NOT NULL REFERENCES roadbooks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  request TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  UNIQUE (roadbook_id, version)
);
CREATE TABLE rides_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadbook_id INTEGER NOT NULL REFERENCES roadbooks(id) ON DELETE CASCADE,
  roadbook_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  ride_date TEXT,
  departure TEXT,
  start TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'ridden', 'cancelled')),
  stale INTEGER NOT NULL DEFAULT 0,
  day_extras TEXT,
  track TEXT,
  rating INTEGER,
  notes TEXT
);
CREATE UNIQUE INDEX rides_roadbook_day ON rides_v2(roadbook_id, ride_date);
CREATE TABLE legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadbook_id INTEGER NOT NULL REFERENCES roadbooks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  from_label TEXT NOT NULL,
  to_label TEXT NOT NULL,
  from_coords TEXT NOT NULL,
  to_coords TEXT NOT NULL,
  distance_km REAL NOT NULL,
  riding_minutes INTEGER NOT NULL,
  main_roads TEXT NOT NULL,
  rating INTEGER,
  notes TEXT
);
CREATE INDEX legs_roadbook ON legs(roadbook_id, seq);
CREATE TABLE ride_notes_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadbook_id INTEGER NOT NULL REFERENCES roadbooks(id) ON DELETE CASCADE,
  ride_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  text TEXT NOT NULL,
  rating INTEGER,
  minutes_back INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  placement TEXT
);
CREATE INDEX ride_notes_roadbook ON ride_notes_v2(roadbook_id, id);
CREATE TABLE road_ratings_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadbook_id INTEGER REFERENCES roadbooks(id) ON DELETE SET NULL,
  note_id INTEGER REFERENCES ride_notes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  road TEXT NOT NULL,
  rating INTEGER NOT NULL,
  reason TEXT,
  approximate INTEGER NOT NULL,
  cells TEXT NOT NULL
);
CREATE TABLE runs_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  home TEXT NOT NULL,
  request TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  usage TEXT NOT NULL,
  cost_usd REAL,
  result TEXT,
  roadbook_id INTEGER REFERENCES roadbooks(id) ON DELETE SET NULL,
  error TEXT
);
`);

  const lastId =
    (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'rides'").get() as { seq: number } | undefined)?.seq ?? 0;
  type Cell = string | number | null;
  const rides = db.prepare("SELECT * FROM rides ORDER BY id").all() as unknown as Array<{
    [
      column in
        | "id"
        | "name"
        | "created_at"
        | "parent_id"
        | "home"
        | "ride_date"
        | "departure"
        | "distance_km"
        | "riding_minutes"
        | "waypoints"
        | "round_trip"
        | "speed_limits"
        | "preferences"
        | "request"
        | "itinerary"
        | "maps_url"
        | "cells"
        | "center_lat"
        | "center_lon"
        | "rating"
        | "notes"
        | "usage"
        | "shapes"
        | "extras"
    ]: Cell;
  }>;
  const insertRoadbook = db.prepare(
    `INSERT INTO roadbooks (id, name, created_at, updated_at, variant_of, version, home, distance_km, riding_minutes,
       waypoints, round_trip, speed_limits, preferences, request, itinerary, maps_url, cells, center_lat, center_lon,
       shapes, usage, route_extras, rating, notes)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRide = db.prepare(
    `INSERT INTO rides_v2 (roadbook_id, roadbook_version, created_at, ride_date, departure, start, status, day_extras)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rides) {
    // Cameras and stop candidates follow the road; the rest belongs to the day.
    const extras = r.extras ? (JSON.parse(String(r.extras)) as Record<string, unknown>) : null;
    const { cameras, stops, ...day } = extras ?? {};
    insertRoadbook.run(
      r.id,
      r.name,
      r.created_at,
      r.created_at,
      r.parent_id,
      r.home,
      r.distance_km,
      r.riding_minutes,
      r.waypoints,
      r.round_trip,
      r.speed_limits,
      r.preferences,
      r.request,
      r.itinerary,
      r.maps_url,
      r.cells,
      r.center_lat,
      r.center_lon,
      r.shapes ?? null,
      r.usage ?? null,
      extras ? JSON.stringify({ cameras: cameras ?? [], stops: stops ?? {} }) : null,
      r.rating,
      r.notes,
    );
    insertRide.run(
      r.id,
      r.created_at,
      r.ride_date,
      r.departure,
      r.home,
      "planned",
      extras ? JSON.stringify(day) : null,
    );
  }

  db.exec(`INSERT INTO legs (id, roadbook_id, seq, from_label, to_label, from_coords, to_coords, distance_km,
             riding_minutes, main_roads, rating, notes)
           SELECT id, ride_id, seq, from_label, to_label, from_coords, to_coords, distance_km, riding_minutes,
             main_roads, rating, notes FROM segments`);

  const notes = db.prepare("SELECT * FROM ride_notes ORDER BY id").all() as unknown as Array<{
    [column in "id" | "ride_id" | "created_at" | "text" | "rating" | "minutes_back" | "status" | "placement"]: Cell;
  }>;
  const rideOn = db.prepare("SELECT id FROM rides_v2 WHERE roadbook_id = ? AND ride_date = ?");
  const ridden = db.prepare("UPDATE rides_v2 SET status = 'ridden' WHERE id = ?");
  const home = db.prepare("SELECT home FROM roadbooks WHERE id = ?");
  const insertNote = db.prepare(
    `INSERT INTO ride_notes_v2 (id, roadbook_id, ride_id, created_at, text, rating, minutes_back, status, placement)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const n of notes) {
    // A note is left while riding: the ride of that day was ridden, even if it was planned for another.
    const day = localDay(String(n.created_at));
    let ride = (rideOn.get(n.ride_id, day) as { id: number } | undefined)?.id;
    if (ride === undefined) {
      const { home: start } = home.get(n.ride_id) as { home: string };
      ride = Number(insertRide.run(n.ride_id, n.created_at, day, null, start, "ridden", null).lastInsertRowid);
    }
    ridden.run(ride);
    insertNote.run(n.id, n.ride_id, ride, n.created_at, n.text, n.rating, n.minutes_back, n.status, n.placement);
  }

  db.exec(`
INSERT INTO road_ratings_v2 (id, roadbook_id, note_id, created_at, road, rating, reason, approximate, cells)
  SELECT id, ride_id, note_id, created_at, road, rating, reason, approximate, cells FROM road_ratings;
INSERT INTO runs_v2 (id, started_at, home, request, model, effort, usage, cost_usd, result, roadbook_id, error)
  SELECT id, started_at, home, request, model, effort, usage, cost_usd, result, ride_id, error FROM runs;
DROP TABLE road_ratings;
DROP TABLE ride_notes;
DROP TABLE segments;
DROP TABLE runs;
DROP TABLE rides;
ALTER TABLE rides_v2 RENAME TO rides;
ALTER TABLE ride_notes_v2 RENAME TO ride_notes;
ALTER TABLE road_ratings_v2 RENAME TO road_ratings;
ALTER TABLE runs_v2 RENAME TO runs;
`);
  // Ids of deleted rides are never handed out again, as AUTOINCREMENT promised.
  if (lastId > 0) {
    const { changes } = db.prepare("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'roadbooks'").run(lastId);
    if (changes === 0) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('roadbooks', ?)").run(lastId);
  }
}

const versionOf = (db: DatabaseSync) =>
  (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

export interface MigrationResult {
  from: number;
  to: number;
  /** Copy of the file taken before the first pending step, or null (nothing to do, in memory, or a new library). */
  backup: string | null;
}

/** Bring the library to the latest version. Throws, leaving the file as it was, if a step fails. */
export function migrate(db: DatabaseSync, path: string, migrations: Migration[] = MIGRATIONS): MigrationResult {
  const latest = migrations.at(-1)?.version ?? 0;
  const from = versionOf(db);
  if (from > latest) {
    throw new Error(
      `The library ${path} is at schema version ${from}, newer than this version of the app (${latest}). Update the app (git pull) before opening it.`,
    );
  }
  const pending = migrations.filter((step) => step.version > from);
  if (pending.length === 0) return { from, to: from, backup: null };

  let backup: string | null = null;
  const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number };
  if (path !== ":memory:" && tables.n > 0) {
    backup = `${path}.bak-v${from}`;
    // Kept if present: it already holds this version, from an earlier attempt.
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
  }

  for (const step of pending) {
    if (step.rebuild) db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      // Another process may have applied it while this one waited for the lock.
      if (versionOf(db) < step.version) {
        step.up(db);
        if (step.rebuild) {
          const broken = db.prepare("PRAGMA foreign_key_check").all();
          if (broken.length > 0) {
            throw new Error(`${broken.length} broken reference(s), first: ${JSON.stringify(broken[0])}`);
          }
        }
        db.exec(`PRAGMA user_version = ${step.version}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Library migration ${step.version} (${step.name}) failed and was undone: ${reason}.${backup ? ` A copy from before is at ${backup}.` : ""}`,
        { cause: error },
      );
    } finally {
      if (step.rebuild) db.exec("PRAGMA foreign_keys = ON");
    }
  }
  return { from, to: latest, backup };
}
