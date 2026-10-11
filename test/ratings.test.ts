import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { checkItinerary } from "../src/checks.ts";
import { routeCells } from "../src/geometry.ts";
import { rateRoadbook } from "../src/library.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { type RegisteredRoute, type RideContext, ratedRoads, savedRideOverlap } from "../src/session.ts";
import { type NewRide, Store } from "../src/store.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.4, lon: 3 };
const B = { lat: 50.6, lon: 3.3 };
const C = { lat: 50.8, lon: 3 };
const OUT = encodePolyline(bentLine(A, B, 80, 0.02));
const BACK = encodePolyline(bentLine(B, C, 80, 0.02));
const outCells = routeCells([OUT]);
const backCells = routeCells([BACK]);

function loop(cells = [...outCells, ...backCells]): NewRide {
  return {
    name: "Two valleys",
    parentId: null,
    home: "Lille",
    rideDate: null,
    departure: null,
    distanceKm: 120,
    ridingMinutes: 150,
    waypoints: ["A", "B", "C"],
    roundTrip: false,
    speedLimits: {},
    preferences: DEFAULT_PREFERENCES,
    request: "",
    itinerary: "",
    mapsUrl: "",
    cells,
    shapes: [OUT, BACK],
    centerLat: 50.6,
    centerLon: 3.1,
    usage: null,
    extras: null,
    legs: [
      {
        seq: 1,
        from: "A",
        to: "B",
        fromCoords: "50.4,3",
        toCoords: "50.6,3.3",
        distanceKm: 60,
        ridingMinutes: 75,
        mainRoads: ["D 1"],
      },
      {
        seq: 2,
        from: "B",
        to: "C",
        fromCoords: "50.6,3.3",
        toCoords: "50.8,3",
        distanceKm: 60,
        ridingMinutes: 75,
        mainRoads: ["D 2"],
      },
    ],
  };
}

const contextOf = (store: Store, allowRepeat = false) =>
  ({ store, preferences: DEFAULT_PREFERENCES, allowRepeat, lineage: new Set<number>() }) as unknown as RideContext;

const share = (cells: string[], set: Set<string>) => cells.filter((c) => set.has(c)).length / cells.length;

const stretch = (store: Store, rating: number, cells: string[]) =>
  store.addRoadRating({
    rideId: null,
    noteId: null,
    road: "D 1",
    rating,
    reason: null,
    approximate: false,
    cells,
    fromCoords: "50.4,3",
    toCoords: "50.6,3.3",
  });

test("ratings: a stretch rated 0 inside a loved roadbook is avoided, the rest of the roadbook stays loved", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(loop());
  rateRoadbook(store, store.findRide(String(id))!, 5, "superb");
  stretch(store, 0, outCells);
  const rated = ratedRoads(contextOf(store));
  assert.equal(share(outCells, rated.avoid), 1, "the stretch wins on its squares");
  assert.equal(share(outCells, rated.loved), 0);
  assert.ok(
    share(
      backCells.filter((c) => !outCells.includes(c)),
      rated.loved,
    ) === 1,
    "the rest is loved",
  );
});

test("ratings: a leg's own rating wins over its roadbook's; a stretch wins over the leg", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(loop());
  rateRoadbook(store, store.findRide(String(id))!, 5, null);
  store.rateLeg(id, 2, 0, "gravel");
  let rated = ratedRoads(contextOf(store));
  const onlyBack = backCells.filter((c) => !outCells.includes(c));
  assert.equal(share(onlyBack, rated.avoid), 1, "leg 2 rated 0 is avoided despite the roadbook's 5");
  assert.equal(
    share(
      outCells.filter((c) => !backCells.includes(c)),
      rated.loved,
    ),
    1,
    "leg 1 keeps the 5",
  );
  stretch(store, 5, backCells);
  rated = ratedRoads(contextOf(store));
  assert.equal(share(backCells, rated.loved), 1, "the stretch rated 5 wins over the leg rated 0");
});

test("ratings: between two stretches on the same road, the most recent wins", () => {
  const store = new Store(":memory:");
  const older = stretch(store, 5, outCells);
  const newer = stretch(store, 0, outCells);
  const at = store.database.prepare("UPDATE road_ratings SET created_at = ? WHERE id = ?");
  at.run("2026-01-01T00:00:00.000Z", older);
  at.run("2026-06-01T00:00:00.000Z", newer);
  assert.equal(share(outCells, ratedRoads(contextOf(store)).avoid), 1);
  at.run("2026-09-01T00:00:00.000Z", older);
  assert.equal(share(outCells, ratedRoads(contextOf(store)).loved), 1, "rated 5 again later");
});

test("ratings: a roadbook rated 0-1 asks roads or loop; 'roads' rates its legs, 'loop' leaves its roads usable", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(loop());
  const roadbook = store.findRide(String(id))!;
  assert.throws(
    () => rateRoadbook(store, roadbook, 1, "dull"),
    /^Error: What was bad about "Two valleys": the roads themselves, or the way the loop was put together/,
  );
  assert.equal(store.findRide(String(id))!.rating, null, "nothing rated before the answer");
  assert.equal(
    rateRoadbook(store, roadbook, 1, "dull", "loop"),
    'Rated #1 "Two valleys" 1/5 as a loop: its roads stay usable, and loops much like it are not proposed again.',
  );
  let rated = ratedRoads(contextOf(store));
  assert.deepEqual([rated.avoid.size, rated.loved.size], [0, 0], "neutral roads");
  assert.deepEqual(
    store.findRide(String(id))!.legs.map((l) => l.rating),
    [null, null],
  );
  assert.equal(
    rateRoadbook(store, roadbook, 0, "cobbles", "roads"),
    'Rated #1 "Two valleys" 0/5, and its 2 leg(s): their roads are avoided by later plans.',
  );
  const legs = store.findRide(String(id))!.legs;
  assert.deepEqual(
    legs.map((l) => [l.rating, l.notes, typeof l.ratedAt]),
    [
      [0, "cobbles", "string"],
      [0, "cobbles", "string"],
    ],
  );
  rated = ratedRoads(contextOf(store));
  assert.equal(share(outCells, rated.avoid), 1);
  assert.throws(() => rateRoadbook(store, roadbook, 6, null), /from 0 \(never again\) to 5/);
});

test("ratings: a candidate much like a disliked loop is flagged and sent back; allowRepeat lets it through", () => {
  const store = new Store(":memory:");
  // The saved loop shares 60% of the candidate's squares: similar, not a duplicate.
  const candidate = [...outCells, ...backCells];
  const kept = candidate.slice(0, Math.ceil(candidate.length * 0.6));
  const id = store.saveRide(loop(kept));
  rateRoadbook(store, store.findRide(String(id))!, 1, "too many villages", "loop");
  const route = {
    id: "r1",
    cells: candidate,
    trip: {
      shapes: [OUT, BACK],
      complete: true,
      result: { totalDistanceKm: 120, totalRidingMinutes: 150, totalRidingTime: "2h30", usesMotorway: false },
    },
  } as unknown as RegisteredRoute;
  const limits = { maxDistanceKm: null, maxRidingMinutes: null };

  assert.match(
    savedRideOverlap(contextOf(store), candidate).verdict,
    /^LIKE A LOOP THE RIDER DISLIKED: 6\d% the same roads as roadbook #1 "Two valleys", rated 1 \("too many villages"\)/,
  );
  const { violations } = checkItinerary(contextOf(store), route, "Loop, 120 km.", limits);
  assert.match(
    violations.join("\n"),
    /^disliked loop: 6\d% the same roads as roadbook #1 "Two valleys", which the rider rated 1 \("too many villages"\)/m,
  );
  assert.doesNotMatch(violations.join("\n"), /rated roads/, "its roads are not avoided");

  assert.doesNotMatch(
    checkItinerary(contextOf(store, true), route, "Loop, 120 km.", limits).violations.join("\n"),
    /disliked/,
  );
  const evolving = contextOf(store);
  evolving.lineage.add(id);
  assert.doesNotMatch(
    checkItinerary(evolving, route, "Loop, 120 km.", limits).violations.join("\n"),
    /disliked/,
    "the session changes that very roadbook",
  );
});

test("migrations: step 3 dates the ratings, moves a roadbook's 0-1 onto its unrated legs, and gives stretches their ends", () => {
  const path = join(mkdtempSync(join(tmpdir(), "ride-db-")), "library.db");
  const store = new Store(path);
  const id = store.saveRide(loop());
  store.rateLeg(id, 2, 3, "fine");
  stretch(store, 5, ["11200:470", "11201:470", "11202:471"]);
  // Back to version 2: the roadbook rated 0 when that meant its roads.
  store.database.exec(`UPDATE roadbooks SET rating = 0, notes = 'never again', updated_at = '2026-05-01T10:00:00.000Z';
    ALTER TABLE roadbooks DROP COLUMN rated_at; ALTER TABLE legs DROP COLUMN rated_at;
    ALTER TABLE road_ratings DROP COLUMN from_coords; ALTER TABLE road_ratings DROP COLUMN to_coords;
    PRAGMA user_version = 2;`);
  store.close();

  const after = new Store(path);
  const roadbook = after.findRide(String(id))!;
  assert.deepEqual([roadbook.rating, roadbook.ratedAt], [0, "2026-05-01T10:00:00.000Z"]);
  assert.deepEqual(
    roadbook.legs.map((l) => [l.rating, l.notes, l.ratedAt]),
    [
      [0, "never again", "2026-05-01T10:00:00.000Z"],
      [3, "fine", "2026-05-01T10:00:00.000Z"],
    ],
    "an unrated leg takes the roadbook's 0; a leg rated on its own keeps its rating",
  );
  const [road] = after.listRoadRatings();
  assert.deepEqual([road!.fromCoords, road!.toCoords], ["50.40225,3.01120", "50.41125,3.01760"]);
  after.close();
  const backup = new DatabaseSync(`${path}.bak-v2`);
  assert.equal((backup.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 2);
  backup.close();
});
