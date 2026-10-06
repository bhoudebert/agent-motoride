// Road memory: what earlier sessions learnt, derived from the library and the
// traces, and recalled by place and by words. Never typed in, never weather.
import type { DatabaseSync } from "node:sqlite";
import { cellCenter, centroid, type LatLon } from "./geometry.ts";
import type { Store } from "./store.ts";
import { haversineKm } from "./tools/geo.ts";

export type MemoryKind = "ride" | "leg" | "road" | "scout" | "roads";

export interface MemoryItem {
  kind: MemoryKind;
  /** Unique source key, e.g. "ride:7", "scout:12:Vercors". */
  ref: string;
  title: string;
  /** Text searched by words. */
  body: string;
  at: LatLon | null;
  rating: number | null;
  /** When it was learnt (ISO). */
  learntAt: string;
  data: unknown;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  lat REAL,
  lon REAL,
  rating INTEGER,
  learnt_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_place ON memory(lat, lon);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_words USING fts5(title, body, tokenize = "unicode61 remove_diacritics 2");
CREATE TABLE IF NOT EXISTS memory_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const coords = (text: string): LatLon | null => {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
};
const middle = (points: Array<LatLon | null>): LatLon | null => {
  const known = points.filter((p): p is LatLon => p !== null);
  return known.length ? centroid(known) : null;
};

interface ScoutReportPayload {
  area?: string;
  found?: boolean;
  waypoints?: string[];
  distanceKm?: number | null;
  openRoadPct?: number | null;
  pct50?: number | null;
  verdict?: string;
}
interface RoadSearchPayload {
  input?: { location?: string };
  output?: {
    center?: string;
    areaMedianCurviness?: number;
    roads?: Array<{
      ref?: string;
      names?: string[];
      lengthKm?: number;
      curvinessDegPerKm?: number;
      from?: string;
      to?: string;
    }>;
  };
}

/** The memory: kept in the library's SQLite file, next to what it is derived from. */
export class Memory {
  readonly #db: DatabaseSync;
  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
    this.#db = store.database;
    this.#db.exec(SCHEMA);
  }

  #put(item: MemoryItem): void {
    const existing = this.#db.prepare("SELECT id FROM memory WHERE ref = ?").get(item.ref) as
      { id: number } | undefined;
    if (existing) {
      this.#db.prepare("DELETE FROM memory_words WHERE rowid = ?").run(existing.id);
      this.#db.prepare("DELETE FROM memory WHERE id = ?").run(existing.id);
    }
    const { lastInsertRowid } = this.#db
      .prepare(
        "INSERT INTO memory (kind, ref, title, body, lat, lon, rating, learnt_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        item.kind,
        item.ref,
        item.title,
        item.body,
        item.at?.lat ?? null,
        item.at?.lon ?? null,
        item.rating,
        item.learntAt,
        JSON.stringify(item.data),
      );
    this.#db
      .prepare("INSERT INTO memory_words (rowid, title, body) VALUES (?, ?, ?)")
      .run(Number(lastInsertRowid), item.title, item.body);
  }

  #clear(kinds: MemoryKind[]): void {
    const marks = kinds.map(() => "?").join(",");
    this.#db
      .prepare(`DELETE FROM memory_words WHERE rowid IN (SELECT id FROM memory WHERE kind IN (${marks}))`)
      .run(...kinds);
    this.#db.prepare(`DELETE FROM memory WHERE kind IN (${marks})`).run(...kinds);
  }

  /**
   * Bring the memory up to date: the library (rides, legs, rated stretches) is
   * rebuilt, since ratings change; traces are read once, from where the last
   * catch-up stopped. Returns how many trace steps were read.
   */
  sync(): number {
    this.#db.exec("BEGIN");
    try {
      this.#clear(["ride", "leg", "road"]);
      for (const ride of this.#store.listRides()) {
        const towns = ride.legs.map((l) => l.to).join(", ");
        this.#put({
          kind: "ride",
          ref: `ride:${ride.id}`,
          title: ride.name,
          body: [
            ride.name,
            ride.request,
            towns,
            ride.legs.flatMap((l) => l.mainRoads).join(" "),
            ride.notes ?? "",
          ].join(" · "),
          at: { lat: ride.centerLat, lon: ride.centerLon },
          rating: ride.rating,
          learntAt: ride.createdAt,
          data: {
            rideId: ride.id,
            name: ride.name,
            distanceKm: ride.distanceKm,
            rating: ride.rating,
            notes: ride.notes,
          },
        });
        for (const leg of ride.legs) {
          if (leg.rating === null) continue;
          this.#put({
            kind: "leg",
            ref: `leg:${ride.id}:${leg.seq}`,
            title: `${leg.from} -> ${leg.to}`,
            body: [leg.from, leg.to, leg.mainRoads.join(" "), leg.notes ?? ""].join(" · "),
            at: middle([coords(leg.fromCoords), coords(leg.toCoords)]),
            rating: leg.rating,
            learntAt: ride.createdAt,
            data: {
              rideId: ride.id,
              leg: leg.seq,
              from: leg.from,
              to: leg.to,
              fromCoords: leg.fromCoords,
              toCoords: leg.toCoords,
              mainRoads: leg.mainRoads,
              notes: leg.notes,
            },
          });
        }
      }
      for (const road of this.#store.listRoadRatings()) {
        this.#put({
          kind: "road",
          ref: `road:${road.id}`,
          title: road.road,
          body: [road.road, road.reason ?? ""].join(" · "),
          at: road.cells.length ? centroid(road.cells.map(cellCenter)) : null,
          rating: road.rating,
          learntAt: road.createdAt,
          data: { road: road.road, rating: road.rating, why: road.reason, approximate: road.approximate },
        });
      }

      const seen = Number(
        (this.#db.prepare("SELECT value FROM memory_state WHERE key = 'trace'").get() as { value: string } | undefined)
          ?.value ?? 0,
      );
      const steps = this.#db
        .prepare(
          `SELECT id, run_id, at, scope, kind, name, payload FROM trace WHERE id > ?
           AND ((kind = 'answer' AND scope LIKE 'scout:%') OR (kind = 'tool' AND name = 'searchRoads')) ORDER BY id`,
        )
        .all(seen) as Array<{
        id: number;
        run_id: number;
        at: string;
        scope: string;
        kind: string;
        name: string;
        payload: string;
      }>;
      let last = seen;
      for (const step of steps) {
        last = step.id;
        const payload = JSON.parse(step.payload) as unknown;
        if (step.kind === "answer") this.#scout(step, payload as ScoutReportPayload);
        else this.#roads(step, payload as RoadSearchPayload);
      }
      const maxTrace = (this.#db.prepare("SELECT max(id) AS id FROM trace").get() as { id: number | null }).id ?? 0;
      this.#db
        .prepare("INSERT OR REPLACE INTO memory_state (key, value) VALUES ('trace', ?)")
        .run(String(Math.max(last, maxTrace)));
      this.#db.exec("COMMIT");
      return steps.length;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /** A scout's verdict on its area, placed at the middle of its loop without the start. */
  #scout(step: { id: number; run_id: number; at: string; scope: string }, report: ScoutReportPayload): void {
    const area = report.area ?? step.scope.replace(/^scout:/, "");
    const points = (report.waypoints ?? []).map(coords);
    const inner = points.length > 2 ? points.slice(1, -1) : points;
    this.#put({
      kind: "scout",
      ref: `scout:${step.run_id}:${step.id}`,
      title: area,
      body: [area, report.verdict ?? ""].join(" · "),
      at: middle(inner),
      rating: null,
      learntAt: step.at,
      data: {
        area,
        found: report.found ?? false,
        distanceKm: report.distanceKm ?? null,
        openRoadPct: report.openRoadPct ?? null,
        pct50: report.pct50 ?? null,
        verdict: report.verdict ?? "",
      },
    });
  }

  /** The winding roads a road search found, placed at the middle of their starts. */
  #roads(step: { id: number; run_id: number; at: string }, search: RoadSearchPayload): void {
    const roads = (search.output?.roads ?? []).slice(0, 10);
    if (!roads.length) return;
    const place = search.output?.center ?? search.input?.location ?? "an area";
    this.#put({
      kind: "roads",
      ref: `roads:${step.run_id}:${step.id}`,
      title: `Winding roads around ${place}`,
      body: [place, ...roads.map((r) => [r.ref, ...(r.names ?? [])].filter(Boolean).join(" "))].join(" · "),
      at: middle(roads.map((r) => coords(r.from ?? ""))),
      rating: null,
      learntAt: step.at,
      data: {
        place,
        areaMedianCurviness: search.output?.areaMedianCurviness ?? null,
        roads: roads.map((r) => ({
          road: r.ref ?? r.names?.[0] ?? "unnamed",
          curvinessDegPerKm: r.curvinessDegPerKm ?? null,
          lengthKm: r.lengthKm ?? null,
          from: r.from,
          to: r.to,
        })),
      },
    });
  }

  /** Items within `radiusKm` of a point, nearest first. */
  near(at: LatLon, radiusKm: number): Array<MemoryItem & { km: number }> {
    // A box in degrees narrows the scan; the exact distance decides.
    const dLat = radiusKm / 111.2;
    const dLon = radiusKm / (111.2 * Math.max(Math.cos((at.lat * Math.PI) / 180), 0.1));
    const rows = this.#db
      .prepare("SELECT * FROM memory WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?")
      .all(at.lat - dLat, at.lat + dLat, at.lon - dLon, at.lon + dLon) as unknown as MemoryRow[];
    return rows
      .map((row) => ({ ...item(row), km: Math.round(haversineKm(at, { lat: row.lat!, lon: row.lon! }) * 10) / 10 }))
      .filter((i) => i.km <= radiusKm)
      .sort((a, b) => a.km - b.km);
  }

  /** The best matches for words, anywhere (BM25). */
  words(query: string, limit = 8): MemoryItem[] {
    // Each word is quoted, so the rider's text can never be read as FTS syntax.
    const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!terms.length) return [];
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    const rows = this.#db
      .prepare(
        `SELECT memory.* FROM memory_words JOIN memory ON memory.id = memory_words.rowid
         WHERE memory_words MATCH ? ORDER BY bm25(memory_words) LIMIT ?`,
      )
      .all(match, limit) as unknown as MemoryRow[];
    return rows.map(item);
  }
}

interface MemoryRow {
  kind: MemoryKind;
  ref: string;
  title: string;
  body: string;
  lat: number | null;
  lon: number | null;
  rating: number | null;
  learnt_at: string;
  data: string;
}

const item = (row: MemoryRow): MemoryItem => ({
  kind: row.kind,
  ref: row.ref,
  title: row.title,
  body: row.body,
  at: row.lat === null || row.lon === null ? null : { lat: row.lat, lon: row.lon },
  rating: row.rating,
  learntAt: row.learnt_at,
  data: JSON.parse(row.data),
});

const daysSince = (iso: string, now: Date) => Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 86_400_000));

/** One recalled item: its stored fields, and how far it is from the place asked about. */
export type Recalled = Record<string, unknown> & { kmAway: number };

export interface Recall {
  radiusKm: number;
  note: string;
  savedRides: Recalled[];
  lovedStretches: Recalled[];
  avoidedStretches: Recalled[];
  scoutedAreas: Recalled[];
  knownWindingRoads: Recalled[];
  wordMatches?: Array<{ kind: MemoryKind; title: string; rating: number | null; at: LatLon | null; data: unknown }>;
}

/**
 * What the app knows around a place, grouped for the planner: rides with their
 * ratings, loved and avoided stretches, scout verdicts with their age, known
 * winding roads best first, and keyword matches when words are given.
 */
export function recall(
  memory: Memory,
  at: LatLon,
  options: { radiusKm?: number; query?: string; now?: Date } = {},
): Recall {
  const radiusKm = options.radiusKm ?? 40;
  const now = options.now ?? new Date();
  memory.sync();
  const near = memory.near(at, radiusKm);
  const of = (kind: MemoryKind) => near.filter((i) => i.kind === kind);
  const stretches = [...of("leg"), ...of("road")];
  const knownRoads = new Map<string, Recalled>();
  for (const search of of("roads")) {
    const data = search.data as { roads: Array<{ road: string; curvinessDegPerKm: number | null }> };
    for (const road of data.roads) {
      const known = knownRoads.get(road.road);
      if (!known || (road.curvinessDegPerKm ?? 0) > ((known.curvinessDegPerKm as number | null) ?? 0)) {
        knownRoads.set(road.road, { ...road, foundDaysAgo: daysSince(search.learntAt, now), kmAway: search.km });
      }
    }
  }
  return {
    radiusKm,
    note: "Knowledge from earlier sessions. Reuse roads and verdicts; weather is never remembered, check it fresh.",
    savedRides: of("ride").map((i) => ({ ...(i.data as Record<string, unknown>), kmAway: i.km })),
    lovedStretches: stretches
      .filter((i) => (i.rating ?? 0) >= 4)
      .map((i) => ({ ...(i.data as Record<string, unknown>), rating: i.rating, kmAway: i.km })),
    avoidedStretches: stretches
      .filter((i) => i.rating !== null && i.rating <= 1)
      .map((i) => ({ ...(i.data as Record<string, unknown>), rating: i.rating, kmAway: i.km })),
    scoutedAreas: of("scout").map((i) => ({
      ...(i.data as Record<string, unknown>),
      scoutedDaysAgo: daysSince(i.learntAt, now),
      kmAway: i.km,
    })),
    knownWindingRoads: [...knownRoads.values()]
      .sort((a, b) => ((b.curvinessDegPerKm as number) ?? 0) - ((a.curvinessDegPerKm as number) ?? 0))
      .slice(0, 15),
    ...(options.query
      ? {
          wordMatches: memory
            .words(options.query)
            .map((i) => ({ kind: i.kind, title: i.title, rating: i.rating, at: i.at, data: i.data })),
        }
      : {}),
  };
}
