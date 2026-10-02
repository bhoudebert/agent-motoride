import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { RidePreferences } from "./preferences.ts";

const DEFAULT_DB = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "agentride.db");

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
  centerLat: number;
  centerLon: number;
  legs: Array<Omit<SavedLeg, "rating" | "notes">>;
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
CREATE TABLE IF NOT EXISTS tool_cache (
  key TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  output TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

/** Saved rides, their legs, and a cache of tool results, in one SQLite file. */
export class Store {
  readonly path: string;
  readonly #db: DatabaseSync;

  constructor(path = process.env.RIDE_DB || DEFAULT_DB) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.#db.exec(SCHEMA);
  }

  saveRide(ride: NewRide): number {
    this.#db.exec("BEGIN");
    try {
      const { lastInsertRowid } = this.#db
        .prepare(
          `INSERT INTO rides (name, created_at, parent_id, home, ride_date, departure, distance_km, riding_minutes,
             waypoints, round_trip, speed_limits, preferences, request, itinerary, maps_url, cells, center_lat, center_lon)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ride.name, new Date().toISOString(), ride.parentId, ride.home, ride.rideDate, ride.departure,
          ride.distanceKm, ride.ridingMinutes, JSON.stringify(ride.waypoints), ride.roundTrip ? 1 : 0,
          JSON.stringify(ride.speedLimits), JSON.stringify(ride.preferences), ride.request, ride.itinerary,
          ride.mapsUrl, JSON.stringify(ride.cells), ride.centerLat, ride.centerLon,
        );
      const id = Number(lastInsertRowid);
      const insertLeg = this.#db.prepare(
        `INSERT INTO segments (ride_id, seq, from_label, to_label, from_coords, to_coords, distance_km, riding_minutes, main_roads)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const leg of ride.legs) {
        insertLeg.run(id, leg.seq, leg.from, leg.to, leg.fromCoords, leg.toCoords, leg.distanceKm, leg.ridingMinutes, JSON.stringify(leg.mainRoads));
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
      const row = this.#db.prepare("SELECT * FROM rides WHERE id = ?").get(Number(key)) as unknown as RideRow | undefined;
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
      throw new Error(`"${idOrName}" matches several rides: ${partial.map((r) => `#${r.id} ${r.name}`).join(", ")}. Use the id.`);
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

  deleteRide(id: number): boolean {
    return this.#db.prepare("DELETE FROM rides WHERE id = ?").run(id).changes > 0;
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
