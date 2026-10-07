import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrations.ts";
import type { RidePreferences } from "./preferences.ts";
import { type BikeProfile, DEFAULT_PROFILE } from "./profile.ts";
import type { RideConditions } from "./conditions.ts";
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
  /** Crosswind and low-sun stretches for the ride date. */
  conditions?: RideConditions | null;
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

/** A note left during a ride: what the rider said, about the last few minutes. */
export interface RideNote {
  id: number;
  /** The roadbook. */
  rideId: number;
  /** The ride (the day) it was left on, if known. */
  dayId: number | null;
  /** ISO time the note was left: its window ends there. */
  createdAt: string;
  text: string;
  rating: number | null;
  minutesBack: number;
  /** pending until reviewed; reviewed once its road was rated or the rider dismissed it. */
  status: "pending" | "reviewed" | "dismissed";
  /** Where a review placed the note, kept until the rider confirms it. */
  placement: NotePlacement | null;
}

export interface NotePlacement {
  /** Main roads of the stretch, e.g. "D 938 / D 17". */
  road: string;
  /** Start and end of the stretch, in words. */
  from: string;
  to: string;
  /** Local clock times of the stretch, e.g. "10:32-10:42". */
  window: string;
  km: number;
  cells: string[];
  /** Placed from the plan and elapsed time instead of a recorded track. */
  approximate: boolean;
  /** The note's own rating, else one read from its words; null when the rider must say. */
  proposedRating: number | null;
}

/** A rating for a stretch of road, from a reviewed note. Steers future planning like a leg rating. */
export interface RoadRating {
  id: number;
  rideId: number | null;
  noteId: number | null;
  createdAt: string;
  road: string;
  rating: number;
  reason: string | null;
  /** Placed from the plan and elapsed time, not from a recorded track. */
  approximate: boolean;
  cells: string[];
}

export interface SavedRun extends RunRecord {
  id: number;
  startedAt: string;
}

export interface SavedRide extends Omit<NewRide, "legs"> {
  id: number;
  /** The ride (day) shown with this roadbook: its date, departure and day data; null if it has none. */
  rideDayId: number | null;
  createdAt: string;
  rating: number | null;
  notes: string | null;
  legs: SavedLeg[];
}

/** One page of a list: 20 lines unless asked otherwise. */
export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

export const PER_PAGE = 20;

/** A roadbook on one day, as listed: with its roadbook's number, name and figures. */
export interface RideDay {
  id: number;
  roadbookId: number;
  name: string;
  rideDate: string | null;
  departure: string | null;
  start: string;
  status: "planned" | "ridden" | "cancelled";
  /** The roadbook changed since this ride's day data was gathered. */
  stale: boolean;
  /** Still planned, but its date has passed: ridden or cancelled, the rider has not said. */
  passed: boolean;
  distanceKm: number;
  ridingMinutes: number;
  rating: number | null;
}

export interface RoadbookSummary {
  roadbook: SavedRide;
  rides: number;
  /** Earliest planned ride from today on, or null. */
  nextDate: string | null;
}

/** A past state of a roadbook, kept when it was changed. */
export interface RoadbookVersion {
  version: number;
  /** When this state was replaced. */
  replacedAt: string;
  /** The change that replaced it, in the rider's words. */
  change: string;
  design: Omit<SavedRide, "id" | "createdAt" | "rideDayId" | "rideDate" | "departure" | "rating" | "notes">;
}

/** What a change to a roadbook replaces: its route and figures, and how it was asked for. */
export type RoadbookDesign = Pick<
  NewRide,
  | "waypoints"
  | "roundTrip"
  | "preferences"
  | "itinerary"
  | "distanceKm"
  | "ridingMinutes"
  | "speedLimits"
  | "mapsUrl"
  | "cells"
  | "shapes"
  | "centerLat"
  | "centerLon"
  | "legs"
> & { name?: string };

interface RoadbookRow {
  id: number;
  name: string;
  created_at: string;
  version: number;
  variant_of: number | null;
  home: string;
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
  route_extras: string | null;
}

/** A roadbook on one day (ADR 0023). */
interface DayRow {
  id: number;
  roadbook_id: number;
  ride_date: string | null;
  departure: string | null;
  start: string;
  status: "planned" | "ridden" | "cancelled";
  day_extras: string | null;
  roadbook_version: number;
}

interface RunRow {
  id: number;
  started_at: string;
  home: string;
  request: string;
  usage: string;
  cost_usd: number | null;
  result: string | null;
  roadbook_id: number | null;
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

/** Stop lists are bare arrays per kind; repair any row written as { kind: { stops: [...] } }. */
function normaliseExtras(extras: RideExtras): RideExtras {
  const stops: RideExtras["stops"] = {};
  for (const [kind, value] of Object.entries(extras.stops ?? {})) {
    const list = Array.isArray(value) ? value : (value as { stops?: unknown }).stops;
    if (Array.isArray(list)) stops[kind] = list;
  }
  return { ...extras, stops, errors: extras.errors ?? {} };
}

/** Cameras and stop candidates follow the road (roadbook); the rest of the extras belongs to the day (ride). */
function splitExtras(extras: RideExtras | null): { route: string | null; day: string | null } {
  if (!extras) return { route: null, day: null };
  const { cameras, stops, ...day } = extras;
  return { route: JSON.stringify({ cameras, stops }), day: JSON.stringify(day) };
}

function joinExtras(route: string | null, day: string | null): RideExtras | null {
  if (!route && !day) return null;
  return normaliseExtras({
    gatheredAt: "",
    daylight: null,
    cameras: [],
    stops: {},
    errors: {},
    ...(day ? (JSON.parse(day) as Partial<RideExtras>) : {}),
    ...(route ? (JSON.parse(route) as Partial<RideExtras>) : {}),
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Saved rides, their legs, and a cache of tool results, in one SQLite file.
 * A saved ride is stored as a roadbook (the design) and its ride (the day);
 * this API still shows them as one, until the commands learn both (ADR 0023).
 */
export class Store {
  readonly path: string;
  readonly #db: DatabaseSync;

  /** The SQLite connection, for modules that keep their own tables in the same file (the road memory). */
  get database(): DatabaseSync {
    return this.#db;
  }

  constructor(path = process.env.RIDE_DB || DEFAULT_DB) {
    if (path === DEFAULT_DB) migrateLegacyDb();
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    // A second process (CLI and MCP server) waits for a migration in progress.
    this.#db.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    try {
      migrate(this.#db, path);
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  /** Log a planning session. Returns its run id, to update as the session goes on. */
  startRun(run: RunRecord): number {
    const { lastInsertRowid } = this.#db
      .prepare(
        `INSERT INTO runs (started_at, home, request, model, effort, usage, cost_usd, result, roadbook_id, error)
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

  /** Update a run; a roadbook deleted meanwhile (from another process) is simply not linked. */
  updateRun(id: number, run: RunRecord): void {
    this.#db
      .prepare(
        `UPDATE runs SET request = ?, usage = ?, cost_usd = ?, result = ?,
           roadbook_id = (SELECT id FROM roadbooks WHERE id = ?), error = ? WHERE id = ?`,
      )
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
      rideId: row.roadbook_id,
      error: row.error,
    }));
  }

  saveRide(ride: NewRide): number {
    this.#db.exec("BEGIN");
    try {
      const now = new Date().toISOString();
      const extras = splitExtras(ride.extras);
      const { lastInsertRowid } = this.#db
        .prepare(
          `INSERT INTO roadbooks (name, created_at, updated_at, variant_of, home, distance_km, riding_minutes, waypoints,
             round_trip, speed_limits, preferences, request, itinerary, maps_url, cells, center_lat, center_lon, usage,
             shapes, route_extras)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ride.name,
          now,
          now,
          ride.parentId,
          ride.home,
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
          extras.route,
        );
      const id = Number(lastInsertRowid);
      this.#addDay(id, { date: ride.rideDate, departure: ride.departure, start: ride.home, dayExtras: extras.day });
      const insertLeg = this.#db.prepare(
        `INSERT INTO legs (roadbook_id, seq, from_label, to_label, from_coords, to_coords, distance_km, riding_minutes, main_roads)
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

  #addDay(
    roadbookId: number,
    day: { date: string | null; departure: string | null; start: string; dayExtras: string | null; ridden?: boolean },
  ): number {
    const { lastInsertRowid } = this.#db
      .prepare(
        `INSERT INTO rides (roadbook_id, roadbook_version, created_at, ride_date, departure, start, status, day_extras)
         SELECT id, version, ?, ?, ?, ?, ?, ? FROM roadbooks WHERE id = ?`,
      )
      .run(
        new Date().toISOString(),
        day.date,
        day.departure,
        day.start,
        day.ridden ? "ridden" : "planned",
        day.dayExtras,
        roadbookId,
      );
    return Number(lastInsertRowid);
  }

  /** The ride shown with a roadbook: the next planned one, else the latest planned, else the latest. */
  #currentDay(roadbookId: number): DayRow | undefined {
    return this.#db
      .prepare(
        `SELECT * FROM rides WHERE roadbook_id = ?
         ORDER BY status = 'planned' AND ride_date >= ? DESC,
           CASE WHEN status = 'planned' AND ride_date >= ? THEN ride_date END ASC,
           status = 'planned' DESC, id DESC
         LIMIT 1`,
      )
      .get(roadbookId, localDay(new Date()), localDay(new Date())) as unknown as DayRow | undefined;
  }

  /**
   * Plan a ride of a roadbook on a date: the ride already on that date is
   * updated (departure, planned again), else a new one is added. The roadbook
   * itself is not touched.
   */
  planDay(roadbookId: number, date: string, departure: string): { dayId: number; created: boolean } {
    const existing = this.#db
      .prepare("SELECT id FROM rides WHERE roadbook_id = ? AND ride_date = ?")
      .get(roadbookId, date) as { id: number } | undefined;
    if (existing) {
      this.#db
        .prepare("UPDATE rides SET departure = ?, status = 'planned', stale = 0 WHERE id = ?")
        .run(departure, existing.id);
      return { dayId: existing.id, created: false };
    }
    const roadbook = this.#db.prepare("SELECT home FROM roadbooks WHERE id = ?").get(roadbookId) as
      { home: string } | undefined;
    if (!roadbook) throw new Error(`No roadbook #${roadbookId}.`);
    return {
      dayId: this.#addDay(roadbookId, { date, departure, start: roadbook.home, dayExtras: null }),
      created: true,
    };
  }

  /** A roadbook shown with one of its rides instead of the current one. */
  rideView(roadbookId: number, dayId: number): SavedRide | undefined {
    const row = this.#db.prepare("SELECT * FROM roadbooks WHERE id = ?").get(roadbookId) as unknown as
      RoadbookRow | undefined;
    const day = this.#db.prepare("SELECT * FROM rides WHERE id = ? AND roadbook_id = ?").get(dayId, roadbookId) as
      DayRow | undefined;
    if (!row || !day) return undefined;
    const current = this.#hydrate(row, day);
    if (day.roadbook_version >= row.version) return current;
    // A ride on an earlier version is shown with the design it was planned and ridden on.
    const old = this.#db
      .prepare("SELECT snapshot FROM roadbook_versions WHERE roadbook_id = ? AND version = ?")
      .get(roadbookId, day.roadbook_version) as { snapshot: string } | undefined;
    if (!old) return current;
    const design = JSON.parse(old.snapshot) as Omit<
      SavedRide,
      "id" | "createdAt" | "rideDayId" | "rideDate" | "departure" | "rating" | "notes"
    >;
    const route = design.extras ? JSON.stringify({ cameras: design.extras.cameras, stops: design.extras.stops }) : null;
    return {
      ...current,
      ...design,
      extras: joinExtras(route, day.day_extras),
    };
  }

  #hydrate(row: RoadbookRow, shown?: DayRow): SavedRide {
    const legs = this.#db
      .prepare("SELECT * FROM legs WHERE roadbook_id = ? ORDER BY seq")
      .all(row.id) as unknown as SegmentRow[];
    const day = shown ?? this.#currentDay(row.id);
    return {
      id: row.id,
      rideDayId: day?.id ?? null,
      name: row.name,
      createdAt: row.created_at,
      parentId: row.variant_of,
      home: row.home,
      rideDate: day?.ride_date ?? null,
      departure: day?.departure ?? null,
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
      extras: joinExtras(row.route_extras, day?.day_extras ?? null),
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
    const rows = this.#db.prepare("SELECT * FROM roadbooks ORDER BY id").all() as unknown as RoadbookRow[];
    return rows.map((row) => this.#hydrate(row));
  }

  /** Roadbooks, newest first, one page at a time. */
  listRoadbooks(page = 1, perPage = PER_PAGE): Page<RoadbookSummary> {
    const total = (this.#db.prepare("SELECT count(*) AS n FROM roadbooks").get() as { n: number }).n;
    const rows = this.#db
      .prepare("SELECT * FROM roadbooks ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(perPage, (page - 1) * perPage) as unknown as RoadbookRow[];
    const today = localDay(new Date());
    const counts = this.#db.prepare(
      `SELECT count(*) AS rides,
         min(CASE WHEN status = 'planned' AND ride_date >= ? THEN ride_date END) AS next_date
       FROM rides WHERE roadbook_id = ?`,
    );
    const items = rows.map((row) => {
      const { rides, next_date } = counts.get(today, row.id) as { rides: number; next_date: string | null };
      return { roadbook: this.#hydrate(row), rides, nextDate: next_date };
    });
    return { items, page, pages: Math.max(1, Math.ceil(total / perPage)), total };
  }

  /** Rides by date, latest first, rides with no date yet last, one page at a time. */
  listRideDays(page = 1, perPage = PER_PAGE): Page<RideDay> {
    const today = localDay(new Date());
    const total = (this.#db.prepare("SELECT count(*) AS n FROM rides").get() as { n: number }).n;
    const rows = this.#db
      .prepare(
        // A ride on an earlier version is listed with that version's figures.
        `SELECT r.id, r.roadbook_id, b.name, r.ride_date, r.departure, r.start, r.status, r.stale,
           coalesce(json_extract(v.snapshot, '$.distanceKm'), b.distance_km) AS distance_km,
           coalesce(json_extract(v.snapshot, '$.ridingMinutes'), b.riding_minutes) AS riding_minutes, r.rating
         FROM rides r JOIN roadbooks b ON b.id = r.roadbook_id
         LEFT JOIN roadbook_versions v ON v.roadbook_id = r.roadbook_id AND v.version = r.roadbook_version
         ORDER BY r.ride_date IS NULL, r.ride_date DESC, r.departure DESC, r.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(perPage, (page - 1) * perPage) as Array<{
      id: number;
      roadbook_id: number;
      name: string;
      ride_date: string | null;
      departure: string | null;
      start: string;
      status: RideDay["status"];
      stale: number;
      distance_km: number;
      riding_minutes: number;
      rating: number | null;
    }>;
    const items = rows.map((r) => ({
      id: r.id,
      roadbookId: r.roadbook_id,
      name: r.name,
      rideDate: r.ride_date,
      departure: r.departure,
      start: r.start,
      status: r.status,
      stale: r.stale === 1,
      passed: r.status === "planned" && r.ride_date !== null && r.ride_date < today,
      distanceKm: r.distance_km,
      ridingMinutes: r.riding_minutes,
      rating: r.rating,
    }));
    return { items, page, pages: Math.max(1, Math.ceil(total / perPage)), total };
  }

  /** Find a ride by numeric id, or by name (exact first, then unique partial match). */
  findRide(idOrName: string): SavedRide | undefined {
    const key = idOrName.trim().replace(/^#/, "");
    if (/^\d+$/.test(key)) {
      const row = this.#db.prepare("SELECT * FROM roadbooks WHERE id = ?").get(Number(key)) as unknown as
        RoadbookRow | undefined;
      return row && this.#hydrate(row);
    }
    const exact = this.#db
      .prepare("SELECT * FROM roadbooks WHERE lower(name) = lower(?) ORDER BY id DESC")
      .get(key) as unknown as RoadbookRow | undefined;
    if (exact) return this.#hydrate(exact);
    const partial = this.#db
      .prepare("SELECT * FROM roadbooks WHERE instr(lower(name), lower(?)) > 0 ORDER BY id DESC")
      .all(key) as unknown as RoadbookRow[];
    if (partial.length > 1) {
      throw new Error(
        `"${idOrName}" matches several rides: ${partial.map((r) => `#${r.id} ${r.name}`).join(", ")}. Use the id.`,
      );
    }
    return partial[0] && this.#hydrate(partial[0]);
  }

  rateRide(id: number, rating: number, notes: string | null): boolean {
    const result = this.#db
      .prepare("UPDATE roadbooks SET rating = ?, notes = coalesce(?, notes) WHERE id = ?")
      .run(rating, notes, id);
    return result.changes > 0;
  }

  rateLeg(rideId: number, seq: number, rating: number, notes: string | null): boolean {
    const result = this.#db
      .prepare("UPDATE legs SET rating = ?, notes = coalesce(?, notes) WHERE roadbook_id = ? AND seq = ?")
      .run(rating, notes, rideId, seq);
    return result.changes > 0;
  }

  /**
   * Change a roadbook in place: its current design is kept as a version (with
   * the change that replaced it), the new one takes its place under the same
   * number. Planned rides move to the new version, their day data stale until
   * refreshed; ridden rides keep the version they rode. Returns the new version.
   */
  reviseRoadbook(id: number, design: RoadbookDesign, change: string): number {
    const before = this.findRide(String(id));
    if (!before) throw new Error(`No roadbook #${id}.`);
    const row = this.#db.prepare("SELECT version FROM roadbooks WHERE id = ?").get(id) as { version: number };
    const {
      id: _id,
      createdAt: _c,
      rideDayId: _d,
      rideDate: _r,
      departure: _p,
      rating: _g,
      notes: _n,
      ...kept
    } = before;
    this.#db.exec("BEGIN");
    try {
      this.#db
        .prepare(
          "INSERT INTO roadbook_versions (roadbook_id, version, created_at, request, snapshot) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, row.version, new Date().toISOString(), change, JSON.stringify(kept));
      const version = row.version + 1;
      this.#db
        .prepare(
          `UPDATE roadbooks SET name = coalesce(?, name), version = ?, updated_at = ?, waypoints = ?, round_trip = ?,
             preferences = ?, itinerary = ?, distance_km = ?, riding_minutes = ?, speed_limits = ?, maps_url = ?,
             cells = ?, shapes = ?, center_lat = ?, center_lon = ?, route_extras = NULL
           WHERE id = ?`,
        )
        .run(
          design.name?.trim() || null,
          version,
          new Date().toISOString(),
          JSON.stringify(design.waypoints),
          design.roundTrip ? 1 : 0,
          JSON.stringify(design.preferences),
          design.itinerary,
          design.distanceKm,
          design.ridingMinutes,
          JSON.stringify(design.speedLimits),
          design.mapsUrl,
          JSON.stringify(design.cells),
          design.shapes && JSON.stringify(design.shapes),
          design.centerLat,
          design.centerLon,
          id,
        );
      this.#db.prepare("DELETE FROM legs WHERE roadbook_id = ?").run(id);
      const insertLeg = this.#db.prepare(
        `INSERT INTO legs (roadbook_id, seq, from_label, to_label, from_coords, to_coords, distance_km, riding_minutes, main_roads)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const leg of design.legs) {
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
      this.#db
        // Only rides still ahead follow; a ride done, or whose day has passed, keeps what it was.
        .prepare(
          `UPDATE rides SET roadbook_version = ?, stale = 1
           WHERE roadbook_id = ? AND status = 'planned' AND (ride_date IS NULL OR ride_date >= ?)`,
        )
        .run(version, id, localDay(new Date()));
      this.#db.exec("COMMIT");
      return version;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Put a planned ride back on the version it had before the last change, for a
   * ride already settled when the roadbook was changed for later ones.
   */
  keepPreviousVersion(dayId: number): number {
    const ride = this.#db.prepare("SELECT * FROM rides WHERE id = ?").get(dayId) as DayRow | undefined;
    if (!ride) throw new Error("No such ride.");
    if (ride.status !== "planned") throw new Error(`This ride is ${ride.status}: it already keeps its version.`);
    const previous = this.#db
      .prepare("SELECT max(version) AS v FROM roadbook_versions WHERE roadbook_id = ? AND version < ?")
      .get(ride.roadbook_id, ride.roadbook_version) as { v: number | null };
    if (previous.v === null) throw new Error("The roadbook has no earlier version for this ride.");
    this.#db.prepare("UPDATE rides SET roadbook_version = ?, stale = 0 WHERE id = ?").run(previous.v, dayId);
    return previous.v;
  }

  /** Past states of a roadbook, oldest first. */
  listVersions(id: number): RoadbookVersion[] {
    const rows = this.#db
      .prepare(
        "SELECT version, created_at, request, snapshot FROM roadbook_versions WHERE roadbook_id = ? ORDER BY version",
      )
      .all(id) as Array<{ version: number; created_at: string; request: string; snapshot: string }>;
    return rows.map((r) => ({
      version: r.version,
      replacedAt: r.created_at,
      change: r.request,
      design: JSON.parse(r.snapshot),
    }));
  }

  /** The roadbook's current version number. */
  versionOf(id: number): number | undefined {
    return (this.#db.prepare("SELECT version FROM roadbooks WHERE id = ?").get(id) as { version: number } | undefined)
      ?.version;
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
          `UPDATE roadbooks SET distance_km = ?, riding_minutes = ?, speed_limits = ?, maps_url = ?, cells = ?, shapes = ?,
             center_lat = ?, center_lon = ?, updated_at = ?
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
          new Date().toISOString(),
          id,
        );
      const update = this.#db.prepare(
        `UPDATE legs SET from_label = ?, to_label = ?, from_coords = ?, to_coords = ?, distance_km = ?, riding_minutes = ?, main_roads = ?
         WHERE roadbook_id = ? AND seq = ?`,
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

  /** Store gathered extras: route-bound ones on the roadbook, day-bound ones on the given ride, else its current one. */
  setExtras(id: number, extras: RideExtras, dayId?: number | null): void {
    const { route, day } = splitExtras(extras);
    const roadbook = this.#db
      .prepare("UPDATE roadbooks SET route_extras = ? WHERE id = ? RETURNING home")
      .get(route, id) as { home: string } | undefined;
    if (!roadbook) return;
    const current = dayId ? { id: dayId } : this.#currentDay(id);
    if (current) {
      this.#db
        .prepare("UPDATE rides SET day_extras = ?, stale = 0 WHERE id = ? AND roadbook_id = ?")
        .run(day, current.id, id);
    } else this.#addDay(id, { date: null, departure: null, start: roadbook.home, dayExtras: day });
  }

  /** Attach the exact route line to a ride saved without one. */
  setRouteLine(id: number, shapes: string[], cells: string[]): void {
    this.#db
      .prepare("UPDATE roadbooks SET shapes = ?, cells = ? WHERE id = ?")
      .run(JSON.stringify(shapes), JSON.stringify(cells), id);
  }

  /** Delete a roadbook with its legs, rides and notes; road ratings stay, they are about the roads. */
  deleteRide(id: number): boolean {
    return this.#db.prepare("DELETE FROM roadbooks WHERE id = ?").run(id).changes > 0;
  }

  /** What deleting a roadbook takes with it, and what stays. */
  roadbookImpact(id: number): { rides: number; notes: number; roadRatings: number } {
    const count = (sql: string) => (this.#db.prepare(sql).get(id) as { n: number }).n;
    return {
      rides: count("SELECT count(*) AS n FROM rides WHERE roadbook_id = ?"),
      notes: count("SELECT count(*) AS n FROM ride_notes WHERE roadbook_id = ?"),
      roadRatings: count("SELECT count(*) AS n FROM road_ratings WHERE roadbook_id = ?"),
    };
  }

  /** The ride of a roadbook on a day, if there is one. */
  findRideOn(
    roadbookId: number,
    date: string,
  ): { id: number; departure: string | null; status: RideDay["status"]; notes: number } | undefined {
    return this.#db
      .prepare(
        `SELECT id, departure, status, (SELECT count(*) FROM ride_notes n WHERE n.ride_id = rides.id) AS notes
         FROM rides WHERE roadbook_id = ? AND ride_date = ?`,
      )
      .get(roadbookId, date) as
      { id: number; departure: string | null; status: RideDay["status"]; notes: number } | undefined;
  }

  /**
   * Rate how a ride went, the day itself (weather, traffic, company): it marks
   * the ride ridden and never counts as a rating of the roads.
   */
  rateRideDay(dayId: number, rating: number, notes: string | null): boolean {
    return (
      this.#db
        .prepare("UPDATE rides SET rating = ?, notes = coalesce(?, notes), status = 'ridden' WHERE id = ?")
        .run(rating, notes, dayId).changes > 0
    );
  }

  /** The rides of one roadbook, latest date first, undated last. */
  ridesOf(roadbookId: number): Array<{
    id: number;
    rideDate: string | null;
    departure: string | null;
    status: RideDay["status"];
    stale: boolean;
    passed: boolean;
    rating: number | null;
    notes: string | null;
  }> {
    const today = localDay(new Date());
    const rows = this.#db
      .prepare(
        `SELECT id, ride_date, departure, status, stale, rating, notes FROM rides WHERE roadbook_id = ?
         ORDER BY ride_date IS NULL, ride_date DESC, id DESC`,
      )
      .all(roadbookId) as Array<{
      id: number;
      ride_date: string | null;
      departure: string | null;
      status: RideDay["status"];
      stale: number;
      rating: number | null;
      notes: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      rideDate: r.ride_date,
      departure: r.departure,
      status: r.status,
      stale: r.stale === 1,
      passed: r.status === "planned" && r.ride_date !== null && r.ride_date < today,
      rating: r.rating,
      notes: r.notes,
    }));
  }

  /** The next planned ride from a day on, any roadbook: the soonest date, then the earliest departure. */
  nextPlannedRide(today: string): { roadbookId: number; dayId: number } | undefined {
    const row = this.#db
      .prepare(
        `SELECT roadbook_id, id FROM rides WHERE status = 'planned' AND ride_date >= ?
         ORDER BY ride_date, departure, id LIMIT 1`,
      )
      .get(today) as { roadbook_id: number; id: number } | undefined;
    return row && { roadbookId: row.roadbook_id, dayId: row.id };
  }

  /** Cancel a ride: kept, shown as cancelled. */
  cancelRide(dayId: number): boolean {
    return this.#db.prepare("UPDATE rides SET status = 'cancelled' WHERE id = ?").run(dayId).changes > 0;
  }

  /** Delete one ride; its notes stay on the roadbook. */
  deleteRideDay(dayId: number): boolean {
    return this.#db.prepare("DELETE FROM rides WHERE id = ?").run(dayId).changes > 0;
  }

  /**
   * Drop expired lookups, fold the journal into the file and compact it. Traces
   * and everything saved are kept. Sizes are of the file and its journal.
   */
  tidy(): { expired: number; beforeBytes: number; afterBytes: number } {
    const size = () =>
      this.path === ":memory:"
        ? 0
        : ["", "-wal"].reduce(
            (sum, suffix) => sum + (existsSync(this.path + suffix) ? statSync(this.path + suffix).size : 0),
            0,
          );
    const beforeBytes = size();
    const expired = Number(this.#db.prepare("DELETE FROM tool_cache WHERE expires_at <= ?").run(Date.now()).changes);
    this.#db.exec("VACUUM");
    this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { expired, beforeBytes, afterBytes: size() };
  }

  addNote(note: { rideId: number; text: string; rating: number | null; minutesBack: number; at?: Date }): RideNote {
    const at = note.at ?? new Date();
    const createdAt = at.toISOString();
    // A note is left while riding: the ride of that day was ridden, even if it was planned for another.
    const day = localDay(at);
    const roadbook = this.#db.prepare("SELECT home FROM roadbooks WHERE id = ?").get(note.rideId) as
      { home: string } | undefined;
    if (!roadbook) throw new Error(`No roadbook #${note.rideId}.`);
    const existing = this.#db
      .prepare("SELECT id FROM rides WHERE roadbook_id = ? AND ride_date = ?")
      .get(note.rideId, day) as { id: number } | undefined;
    const ride =
      existing?.id ?? this.#addDay(note.rideId, { date: day, departure: null, start: roadbook.home, dayExtras: null });
    this.#db.prepare("UPDATE rides SET status = 'ridden' WHERE id = ?").run(ride);
    const { lastInsertRowid } = this.#db
      .prepare(
        "INSERT INTO ride_notes (roadbook_id, ride_id, created_at, text, rating, minutes_back) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(note.rideId, ride, createdAt, note.text, note.rating, note.minutesBack);
    return {
      id: Number(lastInsertRowid),
      rideId: note.rideId,
      dayId: ride,
      createdAt,
      text: note.text,
      rating: note.rating,
      minutesBack: note.minutesBack,
      status: "pending",
      placement: null,
    };
  }

  /** Notes, oldest first; pending ones only unless all is set. */
  listNotes(options: { rideId?: number; all?: boolean } = {}): RideNote[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM ride_notes WHERE (? IS NULL OR roadbook_id = ?) AND (? OR status = 'pending') ORDER BY created_at, id`,
      )
      .all(options.rideId ?? null, options.rideId ?? null, options.all ? 1 : 0) as Array<{
      id: number;
      roadbook_id: number;
      ride_id: number | null;
      created_at: string;
      text: string;
      rating: number | null;
      minutes_back: number;
      status: RideNote["status"];
      placement: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      rideId: row.roadbook_id,
      dayId: row.ride_id,
      createdAt: row.created_at,
      text: row.text,
      rating: row.rating,
      minutesBack: row.minutes_back,
      status: row.status,
      placement: row.placement ? JSON.parse(row.placement) : null,
    }));
  }

  setNotePlacement(id: number, placement: NotePlacement | null): void {
    this.#db
      .prepare("UPDATE ride_notes SET placement = ? WHERE id = ?")
      .run(placement && JSON.stringify(placement), id);
  }

  setNoteStatus(id: number, status: RideNote["status"]): boolean {
    return this.#db.prepare("UPDATE ride_notes SET status = ? WHERE id = ?").run(status, id).changes > 0;
  }

  addRoadRating(rating: Omit<RoadRating, "id" | "createdAt">): number {
    const { lastInsertRowid } = this.#db
      .prepare(
        `INSERT INTO road_ratings (roadbook_id, note_id, created_at, road, rating, reason, approximate, cells)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rating.rideId,
        rating.noteId,
        new Date().toISOString(),
        rating.road,
        rating.rating,
        rating.reason,
        rating.approximate ? 1 : 0,
        JSON.stringify(rating.cells),
      );
    return Number(lastInsertRowid);
  }

  listRoadRatings(): RoadRating[] {
    const rows = this.#db.prepare("SELECT * FROM road_ratings ORDER BY id").all() as Array<{
      id: number;
      roadbook_id: number | null;
      note_id: number | null;
      created_at: string;
      road: string;
      rating: number;
      reason: string | null;
      approximate: number;
      cells: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      rideId: row.roadbook_id,
      noteId: row.note_id,
      createdAt: row.created_at,
      road: row.road,
      rating: row.rating,
      reason: row.reason,
      approximate: row.approximate === 1,
      cells: JSON.parse(row.cells),
    }));
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
