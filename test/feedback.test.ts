import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addRideNote,
  applyReview,
  formatReview,
  parseGpxTrack,
  pendingNotesSummary,
  proposedRating,
  reviewRide,
  rideToReview,
} from "../src/feedback.ts";
import { routeCells } from "../src/geometry.ts";
import { type RideContext, ratedRoads } from "../src/session.ts";
import { type NewRide, Store } from "../src/store.ts";
import { installFakeServices } from "./helpers/fakeServices.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

installFakeServices();

const TZ = "Europe/Paris"; // UTC+2 on the ride day
const A = { lat: 50.4, lon: 3.0 };
const B = { lat: 50.6, lon: 3.0 };
const shapes = [encodePolyline(bentLine(A, B, 200))];
const DEPARTURE_UTC = Date.parse("2026-10-04T07:00:00Z"); // 09:00 in Paris

function saveRide(store: Store, rideDate: string | null = "2026-10-04"): number {
  const ride: NewRide = {
    name: "Straight north",
    parentId: null,
    home: "A",
    rideDate,
    departure: "09:00",
    distanceKm: 22.2,
    ridingMinutes: 30,
    waypoints: ["A", "B"],
    roundTrip: false,
    speedLimits: {},
    preferences: { avoidMotorways: true, max30Pct: 3, max50Pct: 20 },
    request: "test",
    itinerary: "text",
    mapsUrl: "https://maps",
    cells: routeCells(shapes),
    shapes,
    centerLat: 50.5,
    centerLon: 3,
    usage: null,
    extras: null,
    legs: [
      {
        seq: 1,
        from: "A",
        to: "B",
        fromCoords: "50.4,3",
        toCoords: "50.6,3",
        distanceKm: 22.2,
        ridingMinutes: 30,
        mainRoads: ["D 938"],
      },
    ],
  };
  return store.saveRide(ride);
}

/** The plan ridden in 30 minutes, one point every 10 s, with a sideways detour of about 3.5 km between minutes 10 and 20. */
function recordedGpx(): string {
  const points: string[] = [];
  for (let s = 0; s <= 1800; s += 10) {
    const minute = s / 60;
    const lat = A.lat + (B.lat - A.lat) * (s / 1800);
    const lon = A.lon + (minute > 10 && minute < 20 ? 0.05 * Math.sin((Math.PI * (minute - 10)) / 10) : 0);
    const time = new Date(DEPARTURE_UTC + s * 1000).toISOString();
    points.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>40</ele><time>${time}</time></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Recorded</name><trkseg>${points.join("")}</trkseg></trk></gpx>`;
}

const at = (minutesAfterDeparture: number) => new Date(DEPARTURE_UTC + minutesAfterDeparture * 60_000);

test("track: time-stamped points parsed in order; a planned route without times is refused", () => {
  const track = parseGpxTrack(recordedGpx());
  assert.equal(track.length, 181);
  assert.ok(track[1]!.time > track[0]!.time);
  assert.throws(
    () => parseGpxTrack('<gpx><rte><rtept lat="50" lon="3"/><rtept lat="51" lon="3"/></rte></gpx>'),
    /recorded track/,
  );
});

test("ratings proposed from the note's own rating, else its words", () => {
  assert.equal(proposedRating({ rating: 3, text: "never again" }), 3);
  assert.equal(proposedRating({ rating: null, text: "cobbles, never again" }), 0);
  assert.equal(proposedRating({ rating: null, text: "last 10 min awesome" }), 5);
  assert.equal(proposedRating({ rating: null, text: "lots of gravel" }), 1);
  assert.equal(proposedRating({ rating: null, text: "nice bends" }), 4);
  assert.equal(proposedRating({ rating: null, text: "stopped for a photo" }), null);
});

test("notes go to today's ride by default and are announced until reviewed", () => {
  const store = new Store(":memory:");
  const today = new Intl.DateTimeFormat("en-CA").format(Date.now());
  const older = saveRide(store, today);
  saveRide(store, "2026-01-01");
  const { note, ride } = addRideNote(store, { text: "great view" });
  assert.equal(ride.id, older);
  assert.equal(note.minutesBack, 10);
  assert.throws(() => addRideNote(store, { text: "x", rating: 7 }), /0 \(never again\) to 5/);
  assert.match(pendingNotesSummary(store)!, /1 ride note waiting for review \(roadbook #1\)/);
  assert.equal(rideToReview(store, undefined).id, older);
});

test("review with a track: notes on the road ridden, detour flagged, pace measured, ratings steer planning", async () => {
  const store = new Store(":memory:");
  const id = saveRide(store);
  const awesome = addRideNote(store, { ride: String(id), text: "last 10 min awesome", at: at(30) }).note;
  const cobbles = addRideNote(store, {
    ride: String(id),
    text: "cobbles, never again",
    minutesBack: 4,
    at: at(5),
  }).note;
  const photo = addRideNote(store, { ride: String(id), text: "stopped for a photo", at: at(15) }).note;

  const review = await reviewRide(store, store.findRide(String(id))!, {
    track: parseGpxTrack(recordedGpx()),
    trackPath: "/rides/2026-10-04.gpx",
    timezone: TZ,
  });

  const day = store.findRideOn(id, "2026-10-04")!;
  assert.equal(day.status, "ridden", "a reviewed track marks its day's ride ridden");
  assert.equal(store.trackOf(day.id), "/rides/2026-10-04.gpx");
  assert.equal(review.track!.points, 181);
  assert.ok(review.track!.km > 22.2, "the detour adds distance");
  assert.equal(review.track!.movingMinutes, 30);
  assert.equal(review.detours.length, 1);
  assert.ok(review.detours[0]!.km >= 2, `detour ${review.detours[0]!.km} km`);
  assert.match(review.detours[0]!.window, /^09:1\d-09:\d\d$/);

  const placed = review.notes.find((n) => n.note.id === awesome.id)!.placement!;
  assert.equal(placed.window, "09:20-09:30");
  assert.equal(placed.approximate, false);
  assert.equal(placed.road, "D 938 / Rue de la Gare");
  assert.equal(placed.proposedRating, 5);
  assert.match(formatReview(review), /Detours from the plan/);

  const lines = applyReview(store, [
    { noteId: awesome.id },
    { noteId: cobbles.id },
    { noteId: photo.id, dismiss: true },
    { noteId: 999 },
  ]);
  assert.match(lines[0]!, /^Rated 5: D 938/);
  assert.match(lines[1]!, /^Rated 0:/);
  assert.equal(lines[2], `Note #${photo.id} dismissed.`);
  assert.match(lines[3]!, /not a pending note/);
  assert.equal(store.listNotes().length, 0);
  assert.equal(pendingNotesSummary(store), null);

  const ratings = store.listRoadRatings();
  assert.deepEqual(
    ratings.map((r) => [r.rating, r.reason]),
    [
      [5, "last 10 min awesome"],
      [0, "cobbles, never again"],
    ],
  );
  const rated = ratedRoads({ store } as RideContext);
  assert.ok(ratings[0]!.cells.every((cell) => rated.loved.has(cell)));
  assert.ok(ratings[1]!.cells.every((cell) => rated.avoid.has(cell)));
  assert.match(rated.avoidFrom[0]!, /rated 0: "cobbles, never again"/);
});

test("review without a track: notes placed on the plan by elapsed time, marked approximate", async () => {
  const store = new Store(":memory:");
  const id = saveRide(store);
  const { note } = addRideNote(store, { ride: String(id), text: "nice bends", at: at(15) });
  const late = addRideNote(store, { ride: String(id), text: "home", at: at(200) }).note;

  const review = await reviewRide(store, store.findRide(String(id))!, { timezone: TZ });
  assert.equal(review.track, null);
  const placement = review.notes.find((n) => n.note.id === note.id)!.placement!;
  assert.equal(placement.approximate, true);
  assert.equal(placement.window, "09:05-09:15");
  assert.ok(Math.abs(placement.km - 7.4) < 0.5, `about a third of the line, got ${placement.km} km`);
  assert.match(review.notes.find((n) => n.note.id === late.id)!.problem!, /outside the planned riding time/);
  assert.match(formatReview(review), /No recorded track/);

  // Confirming without a rating keeps the proposal; a note never placed cannot be rated.
  assert.match(applyReview(store, [{ noteId: note.id }])[0]!, /^Rated 4: .*\(approximate\)/);
  assert.match(applyReview(store, [{ noteId: late.id }])[0]!, /not placed yet/);
  assert.equal(store.listRoadRatings()[0]!.approximate, true);
});

test("review after a change: notes are placed on the route of the ride they were left on", async () => {
  const store = new Store(":memory:");
  const id = saveRide(store);
  const { note } = addRideNote(store, { ride: String(id), text: "nice bends", at: at(15) });
  // Changed after the ride: a longer route, further east.
  const east = [encodePolyline(bentLine({ lat: 50.4, lon: 3.5 }, { lat: 50.8, lon: 3.5 }, 200))];
  store.reviseRoadbook(
    id,
    {
      waypoints: ["A", "C"],
      roundTrip: false,
      preferences: { avoidMotorways: true, max30Pct: 3, max50Pct: 20 },
      itinerary: "east",
      distanceKm: 44.5,
      ridingMinutes: 60,
      speedLimits: {},
      mapsUrl: "m2",
      cells: routeCells(east),
      shapes: east,
      centerLat: 50.6,
      centerLon: 3.5,
      legs: [
        {
          seq: 1,
          from: "A",
          to: "C",
          fromCoords: "50.4,3.5",
          toCoords: "50.8,3.5",
          distanceKm: 44.5,
          ridingMinutes: 60,
          mainRoads: [],
        },
      ],
    },
    "moved east",
  );
  const review = await reviewRide(store, store.findRide(String(id))!, { timezone: TZ });
  const placement = review.notes.find((n) => n.note.id === note.id)!.placement!;
  const ridden = new Set(routeCells(shapes));
  assert.ok(
    placement.cells.every((cell) => ridden.has(cell)),
    "on the original route, not the eastern one",
  );
  assert.ok(Math.abs(placement.km - 7.4) < 0.5, `at the original pace, got ${placement.km} km`);
});

test("review with a track on a day without a ride: the ride is recorded, ridden, with its track", () => {
  const store = new Store(":memory:");
  const id = saveRide(store, "2026-10-04");
  const dayId = store.recordRidden(id, "2026-10-11", "/rides/2026-10-11.gpx");
  assert.deepEqual(
    store.ridesOf(id).map((r) => [r.rideDate, r.status]),
    [
      ["2026-10-11", "ridden"],
      ["2026-10-04", "planned"],
    ],
  );
  assert.equal(store.trackOf(dayId), "/rides/2026-10-11.gpx");
  assert.equal(store.recordRidden(id, "2026-10-11", "/rides/again.gpx"), dayId, "the same day again: the same ride");
});
