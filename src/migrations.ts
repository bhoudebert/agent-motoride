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
];

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
