import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { RidePreferences } from "./preferences.ts";
import { type BikeProfile, DEFAULT_PROFILE } from "./profile.ts";
import type { StopPlan } from "./stops.ts";
import type { RunUsage } from "./usage.ts";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");
const DEFAULT_DB = resolve(DATA_DIR, "agentmotoride.db");

/** Libraries created before the rename live in data/agentride.db: move them once. */
function migrateLegacyDb(): void {
  const legacy = resolve(DATA_DIR, "agentride.db");
  if (!existsSync(legacy) || existsSync(DEFAULT_DB)) return;
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(legacy + suffix)) renameSync(legacy + suffix, DEFAULT_DB + suffix);
  }
}

export interface SavedLeg {
  seq: number;
  from: string;
  to: string;
  fromCoords: string;
  toCoords: string;
  distanceKm: number;
  ridingMinutes: number;
  mainRoads: string[];
  rating: number | null;
  notes: string | null;
}

export interface NewRide {
  name: string;
  parentId: number | null;
  home: string;
  rideDate: string | null;
  departure: string | null;
  distanceKm: number;
  ridingMinutes: number;
  waypoints: string[];
  roundTrip: boolean;
  speedLimits: unknown;
  preferences: RidePreferences;
  request: string;
  itinerary: string;
  mapsUrl: string;
  cells: string[];
  /** Exact route line: one encoded polyline per leg. Null on rides saved before it was stored. */
  shapes: string[] | null;
  centerLat: number;
  centerLon: number;
  /** What the planning session had consumed when the ride was saved. */
  usage: RunUsage | null;
  /** Daylight, fixed cameras and stops along the route, gathered at save or refresh. */
  extras: RideExtras | null;
  legs: Array<Omit<SavedLeg, "rating" | "notes">>;
}

export interface RideExtras {
  gatheredAt: string;
  daylight: {
    sunrise: string | null;
    sunset: string | null;
    firstLight: string | null;
    lastLight: string | null;
    daylightHours: number;
  } | null;
  cameras: Array<{
    kmAlongRoute: number;
    leg: number;
    limitKmh: number | string | null;
    direction: string | null;
    coords: string;
  }>;
  stops: Record<
    string,
    Array<{ kmAlongRoute: number; leg: number; name: string; openingHours: string | null; detourM: number }>
  >;
  /** Lookups that failed, by name, with the reason; a refresh retries them. */
  errors: Record<string, string>;
  /** Forecast for the ride date at a few points of the route, when the date was within forecast range. */
  weather?: RideWeather | null;
  /** Fuel, pause and lunch stops chosen from the bike profile. */
  stopPlan?: StopPlan | null;
}

export interface RideWeather {
  forecastDate: string;
  gatheredAt: string;
  /** Hours covered, e.g. "09:00-16:00", from the departure and the riding time. */
  window: string;
  points: Array<{
    label: string;
    kmAlongRoute: number;
    dry: boolean;
    maxRainProbPct: number;
    totalRainMm: number;
    minTempC: number;
    maxTempC: number;
    maxGustKmh: number;
    sky: string;
  }>;
}

/** One planning session, logged whether or not its ride was saved. */
export interface RunRecord {
  home: string;
  request: string;
  usage: RunUsage;
  costUsd: number | null;
  /** Null until the session produced a routed itinerary. */
  result: {
    distanceKm: number;
    ridingMinutes: number;
    openRoadPct: number | null;
    pct50: number | null;
    pct30: number | null;
    motorwayKm: number | null;
    time70Pct?: number | null;
  } | null;
  rideId: number | null;
  error: string | null;
}

export interface SavedRun extends RunRecord {
  id: number;
  startedAt: string;
}

export interface SavedRide extends Omit<NewRide, "legs"> {
  id: number;
  createdAt: string;
  rating: number | null;
  notes: string | null;
  legs: SavedLeg[];
}

interface RideRow {
  id: number;
  name: string;
  created_at: string;
  parent_id: number | null;
  home: string;
  ride_date: string | null;
  departure: string | null;
  distance_km: number;
  riding_minutes: number;
  waypoints: string;
  round_trip: number;
  speed_limits: string;
  preferences: string;
  request: string;
  itinerary: string;
  maps_url: string;
  cells: string;
  center_lat: number;
  center_lon: number;
  rating: number | null;
  notes: string | null;
  usage: string | null;
  shapes: string | null;
  extras: string | null;
}

interface RunRow {
  id: number;
  started_at: string;
  home: string;
  request: string;
  usage: string;
  cost_usd: number | null;
  result: string | null;
  ride_id: number | null;
  error: string | null;
}

interface SegmentRow {
  seq: number;
  from_label: string;
  to_label: string;
  from_coords: string;
  to_coords: string;
  distance_km: number;
  riding_minutes: number;
  main_roads: string;
  rating: number | null;
  notes: string | null;
}

const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS tool_cache (
  key TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  output TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

/** Stop lists are bare arrays per kind; repair any row written as { kind: { stops: [...] } }. */
function normaliseExtras(extras: RideExtras): RideExtras {
  const stops: RideExtras["stops"] = {};
  for (const [kind, value] of Object.entries(extras.stops ?? {})) {
    const list = Array.isArray(value) ? value : (value as { stops?: unknown }).stops;
    if (Array.isArray(list)) stops[kind] = list;
  }
  return { ...extras, stops, errors: extras.errors ?? {} };
}

/** Saved rides, their legs, and a cache of tool results, in one SQLite file. */
export class Store {
  readonly path: string;
  readonly #db: DatabaseSync;

  constructor(path = process.env.RIDE_DB || DEFAULT_DB) {
    if (path === DEFAULT_DB) migrateLegacyDb();
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.#db.exec(SCHEMA);
    // Databases created before usage tracking lack this column.
    const columns = this.#db.prepare("PRAGMA table_info(rides)").all() as Array<{ name: string }>;
    for (const name of ["usage", "shapes", "extras"]) {
      if (!columns.some((column) => column.name === name)) this.#db.exec(`ALTER TABLE rides ADD COLUMN ${name} TEXT`);
    }
  }

  /** Log a planning session. Returns its run id, to update as the session goes on. */
  startRun(run: RunRecord): number {
    const { lastInsertRowid } = this.#db
      .prepare(
        `INSERT INTO runs (started_at, home, request, model, effort, usage, cost_usd, result, ride_id, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        run.home,
        run.request,
        run.usage.model,
        run.usage.effort,
        JSON.stringify(run.usage),
        run.costUsd,
        run.result && JSON.stringify(run.result),
        run.rideId,
        run.error,
      );
    return Number(lastInsertRowid);
  }

  updateRun(id: number, run: RunRecord): void {
    this.#db
      .prepare("UPDATE runs SET request = ?, usage = ?, cost_usd = ?, result = ?, ride_id = ?, error = ? WHERE id = ?")
      .run(
        run.request,
        JSON.stringify(run.usage),
        run.costUsd,
        run.result && JSON.stringify(run.result),
        run.rideId,
        run.error,
        id,
      );
  }

  addTrace(runId: number, event: { scope: string; kind: string; name: string; ms?: number; payload: unknown }): void {
    this.#db
      .prepare("INSERT INTO trace (run_id, at, scope, kind, name, ms, payload) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        runId,
        new Date().toISOString(),
        event.scope,
        event.kind,
        event.name,
        event.ms ?? null,
        JSON.stringify(event.payload ?? null),
      );
  }

  listTrace(
    runId: number,
  ): Array<{ id: number; at: string; scope: string; kind: string; name: string; ms: number | null; payload: unknown }> {
    const rows = this.#db.prepare("SELECT * FROM trace WHERE run_id = ? ORDER BY id").all(runId) as unknown as Array<{
      id: number;
      at: string;
      scope: string;
      kind: string;
      name: string;
      ms: number | null;
      payload: string;
    }>;
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }

  findRun(id: number): SavedRun | undefined {
    return this.listRuns().find((run) => run.id === id);
  }

  listRuns(): SavedRun[] {
    const rows = this.#db.prepare("SELECT * FROM runs ORDER BY id").all() as unknown as RunRow[];
    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      home: row.home,
      request: row.request,
      usage: JSON.parse(row.usage),
      costUsd: row.cost_usd,
      result: row.result ? JSON.parse(row.result) : null,
      rideId: row.ride_id,
      error: row.error,
    }));
  }

  saveRide(ride: NewRide): number {
    this.#db.exec("BEGIN");
    try {
      const { lastInsertRowid } = this.#db
        .prepare(
          `INSERT INTO rides (name, created_at, parent_id, home, ride_date, departure, distance_km, riding_minutes,
             waypoints, round_trip, speed_limits, preferences, request, itinerary, maps_url, cells, center_lat, center_lon, usage, shapes, extras)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ride.name,
          new Date().toISOString(),
          ride.parentId,
          ride.home,
          ride.rideDate,
          ride.departure,
          ride.distanceKm,
          ride.ridingMinutes,
          JSON.stringify(ride.waypoints),
          ride.roundTrip ? 1 : 0,
          JSON.stringify(ride.speedLimits),
          JSON.stringify(ride.preferences),
          ride.request,
          ride.itinerary,
          ride.mapsUrl,
          JSON.stringify(ride.cells),
          ride.centerLat,
          ride.centerLon,
          ride.usage && JSON.stringify(ride.usage),
          ride.shapes && JSON.stringify(ride.shapes),
          ride.extras && JSON.stringify(ride.extras),
        );
      const id = Number(lastInsertRowid);
      const insertLeg = this.#db.prepare(
        `INSERT INTO segments (ride_id, seq, from_label, to_label, from_coords, to_coords, distance_km, riding_minutes, main_roads)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const leg of ride.legs) {
        insertLeg.run(
          id,
          leg.seq,
          leg.from,
          leg.to,
          leg.fromCoords,
          leg.toCoords,
          leg.distanceKm,
          leg.ridingMinutes,
          JSON.stringify(leg.mainRoads),
        );
      }
      this.#db.exec("COMMIT");
      return id;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #hydrate(row: RideRow): SavedRide {
    const legs = this.#db
      .prepare("SELECT * FROM segments WHERE ride_id = ? ORDER BY seq")
      .all(row.id) as unknown as SegmentRow[];
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      parentId: row.parent_id,
      home: row.home,
      rideDate: row.ride_date,
      departure: row.departure,
      distanceKm: row.distance_km,
      ridingMinutes: row.riding_minutes,
      waypoints: JSON.parse(row.waypoints),
      roundTrip: row.round_trip === 1,
      speedLimits: JSON.parse(row.speed_limits),
      preferences: JSON.parse(row.preferences),
      request: row.request,
      itinerary: row.itinerary,
      mapsUrl: row.maps_url,
      cells: JSON.parse(row.cells),
      centerLat: row.center_lat,
      centerLon: row.center_lon,
      usage: row.usage ? JSON.parse(row.usage) : null,
      shapes: row.shapes ? JSON.parse(row.shapes) : null,
      extras: row.extras ? normaliseExtras(JSON.parse(row.extras)) : null,
      rating: row.rating,
      notes: row.notes,
      legs: legs.map((leg) => ({
        seq: leg.seq,
        from: leg.from_label,
        to: leg.to_label,
        fromCoords: leg.from_coords,
        toCoords: leg.to_coords,
        distanceKm: leg.distance_km,
        ridingMinutes: leg.riding_minutes,
        mainRoads: JSON.parse(leg.main_roads),
        rating: leg.rating,
        notes: leg.notes,
      })),
    };
  }

  listRides(): SavedRide[] {
    const rows = this.#db.prepare("SELECT * FROM rides ORDER BY id").all() as unknown as RideRow[];
    return rows.map((row) => this.#hydrate(row));
  }

  /** Find a ride by numeric id, or by name (exact first, then unique partial match). */
  findRide(idOrName: string): SavedRide | undefined {
    const key = idOrName.trim().replace(/^#/, "");
    if (/^\d+$/.test(key)) {
      const row = this.#db.prepare("SELECT * FROM rides WHERE id = ?").get(Number(key)) as unknown as
        RideRow | undefined;
      return row && this.#hydrate(row);
    }
    const exact = this.#db
      .prepare("SELECT * FROM rides WHERE lower(name) = lower(?) ORDER BY id DESC")
      .get(key) as unknown as RideRow | undefined;
    if (exact) return this.#hydrate(exact);
    const partial = this.#db
      .prepare("SELECT * FROM rides WHERE instr(lower(name), lower(?)) > 0 ORDER BY id DESC")
      .all(key) as unknown as RideRow[];
    if (partial.length > 1) {
      throw new Error(
        `"${idOrName}" matches several rides: ${partial.map((r) => `#${r.id} ${r.name}`).join(", ")}. Use the id.`,
      );
    }
    return partial[0] && this.#hydrate(partial[0]);
  }

  rateRide(id: number, rating: number, notes: string | null): boolean {
    const result = this.#db
      .prepare("UPDATE rides SET rating = ?, notes = coalesce(?, notes) WHERE id = ?")
      .run(rating, notes, id);
    return result.changes > 0;
  }

  rateLeg(rideId: number, seq: number, rating: number, notes: string | null): boolean {
    const result = this.#db
      .prepare("UPDATE segments SET rating = ?, notes = coalesce(?, notes) WHERE ride_id = ? AND seq = ?")
      .run(rating, notes, rideId, seq);
    return result.changes > 0;
  }

  /** Replace a ride's computed figures after re-routing it. Ratings and notes are kept. */
  refreshRide(
    id: number,
    data: Pick<
      NewRide,
      | "distanceKm"
      | "ridingMinutes"
      | "speedLimits"
      | "mapsUrl"
      | "cells"
      | "shapes"
      | "centerLat"
      | "centerLon"
      | "legs"
    >,
  ): void {
    this.#db.exec("BEGIN");
    try {
      this.#db
        .prepare(
          `UPDATE rides SET distance_km = ?, riding_minutes = ?, speed_limits = ?, maps_url = ?, cells = ?, shapes = ?, center_lat = ?, center_lon = ?
           WHERE id = ?`,
        )
        .run(
          data.distanceKm,
          data.ridingMinutes,
          JSON.stringify(data.speedLimits),
          data.mapsUrl,
          JSON.stringify(data.cells),
          data.shapes && JSON.stringify(data.shapes),
          data.centerLat,
          data.centerLon,
          id,
        );
      const update = this.#db.prepare(
        `UPDATE segments SET from_label = ?, to_label = ?, from_coords = ?, to_coords = ?, distance_km = ?, riding_minutes = ?, main_roads = ?
         WHERE ride_id = ? AND seq = ?`,
      );
      for (const leg of data.legs) {
        update.run(
          leg.from,
          leg.to,
          leg.fromCoords,
          leg.toCoords,
          leg.distanceKm,
          leg.ridingMinutes,
          JSON.stringify(leg.mainRoads),
          id,
          leg.seq,
        );
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  setExtras(id: number, extras: RideExtras): void {
    this.#db.prepare("UPDATE rides SET extras = ? WHERE id = ?").run(JSON.stringify(extras), id);
  }

  /** Attach the exact route line to a ride saved without one. */
  setRouteLine(id: number, shapes: string[], cells: string[]): void {
    this.#db
      .prepare("UPDATE rides SET shapes = ?, cells = ? WHERE id = ?")
      .run(JSON.stringify(shapes), JSON.stringify(cells), id);
  }

  deleteRide(id: number): boolean {
    return this.#db.prepare("DELETE FROM rides WHERE id = ?").run(id).changes > 0;
  }

  /** The bike profile: stored values over the defaults. */
  getProfile(): BikeProfile {
    const rows = this.#db.prepare("SELECT key, value FROM profile").all() as Array<{ key: string; value: string }>;
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    return { ...DEFAULT_PROFILE, ...stored };
  }

  setProfile(changes: Partial<BikeProfile>): BikeProfile {
    const upsert = this.#db.prepare("INSERT OR REPLACE INTO profile (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(changes)) if (value !== undefined) upsert.run(key, JSON.stringify(value));
    return this.getProfile();
  }

  cacheGet<T>(key: string): T | undefined {
    const row = this.#db
      .prepare("SELECT output FROM tool_cache WHERE key = ? AND expires_at > ?")
      .get(key, Date.now()) as { output: string } | undefined;
    return row ? (JSON.parse(row.output) as T) : undefined;
  }

  cacheSet(key: string, tool: string, value: unknown, ttlMs: number): void {
    this.#db
      .prepare("INSERT OR REPLACE INTO tool_cache (key, tool, output, expires_at) VALUES (?, ?, ?, ?)")
      .run(key, tool, JSON.stringify(value), Date.now() + ttlMs);
  }

  cacheClear(): number {
    return Number(this.#db.prepare("DELETE FROM tool_cache").run().changes);
  }

  cachePurgeExpired(): void {
    this.#db.prepare("DELETE FROM tool_cache WHERE expires_at <= ?").run(Date.now());
  }

  close(): void {
    this.#db.close();
  }
}
