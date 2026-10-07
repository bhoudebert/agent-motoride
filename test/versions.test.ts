import assert from "node:assert/strict";
import { test } from "node:test";
import { copyRoadbook, followingRides, formatRideDayPage, formatVersions, restoreVersion } from "../src/library.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { type NewRide, type RoadbookDesign, Store } from "../src/store.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.6, lon: 3.06 };
const B = { lat: 50.8, lon: 2.49 };
const C = { lat: 50.75, lon: 2.7 };

function original(): NewRide {
  const shapes = [encodePolyline(bentLine(A, B, 30)), encodePolyline(bentLine(B, A, 30))];
  return {
    name: "Monts de Flandre",
    parentId: null,
    home: "Lille",
    rideDate: "2099-05-02",
    departure: "09:00",
    distanceKm: 90,
    ridingMinutes: 110,
    waypoints: ["Lille", "Cassel"],
    roundTrip: true,
    speedLimits: {},
    preferences: DEFAULT_PREFERENCES,
    request: "a loop",
    itinerary: "90 km loop",
    mapsUrl: "m1",
    cells: ["1:1"],
    shapes,
    centerLat: 50.7,
    centerLon: 2.8,
    usage: null,
    extras: null,
    legs: [
      {
        seq: 1,
        from: "Lille",
        to: "Cassel",
        fromCoords: "50.6,3.06",
        toCoords: "50.8,2.49",
        distanceKm: 45,
        ridingMinutes: 55,
        mainRoads: ["D 933"],
      },
      {
        seq: 2,
        from: "Cassel",
        to: "Lille",
        fromCoords: "50.8,2.49",
        toCoords: "50.6,3.06",
        distanceKm: 45,
        ridingMinutes: 55,
        mainRoads: ["D 916"],
      },
    ],
  };
}

const longer: RoadbookDesign = {
  waypoints: ["Lille", "Cassel", "Mont Noir"],
  roundTrip: true,
  preferences: DEFAULT_PREFERENCES,
  itinerary: "140 km loop",
  distanceKm: 140,
  ridingMinutes: 170,
  speedLimits: {},
  mapsUrl: "m2",
  cells: ["2:2"],
  shapes: [encodePolyline(bentLine(A, C, 30)), encodePolyline(bentLine(C, A, 30))],
  centerLat: 50.7,
  centerLon: 2.8,
  legs: [
    {
      seq: 1,
      from: "Lille",
      to: "Mont Noir",
      fromCoords: "50.6,3.06",
      toCoords: "50.75,2.7",
      distanceKm: 70,
      ridingMinutes: 85,
      mainRoads: ["D 948"],
    },
    {
      seq: 2,
      from: "Mont Noir",
      to: "Lille",
      fromCoords: "50.75,2.7",
      toCoords: "50.6,3.06",
      distanceKm: 70,
      ridingMinutes: 85,
      mainRoads: ["D 7"],
    },
  ],
};

const rides = (store: Store) =>
  store.database
    .prepare("SELECT ride_date, status, roadbook_version, stale FROM rides ORDER BY id")
    .all()
    .map((r) => Object.values(r));

test("versions: a change replaces the design under the same number and keeps the old one", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(original());
  store.rateRide(id, 4, "good loop");
  store.addNote({ rideId: id, text: "cold", rating: null, minutesBack: 10, at: new Date(2099, 3, 25, 11) });
  assert.equal(store.reviseRoadbook(id, longer, "50 km longer"), 2);

  const now = store.findRide(String(id))!;
  assert.deepEqual(
    [now.name, now.distanceKm, now.waypoints.length, now.legs[0]!.to],
    ["Monts de Flandre", 140, 3, "Mont Noir"],
  );
  assert.deepEqual([now.rating, now.notes], [4, "good loop"], "the roadbook's own rating and notes stay");
  assert.equal(store.listRoadbooks().total, 1, "no copy");
  const [v1] = store.listVersions(id);
  assert.deepEqual(
    [v1!.version, v1!.change, v1!.design.distanceKm, v1!.design.legs[0]!.to],
    [1, "50 km longer", 90, "Cassel"],
  );
  assert.deepEqual(
    rides(store),
    [
      ["2099-05-02", "planned", 2, 1],
      ["2099-04-25", "ridden", 1, 0],
    ],
    "planned rides move to the new version, stale; a ridden one keeps the version it rode",
  );
  assert.match(
    formatVersions(store, now).join("\n"),
    /^Versions:\n {2}v1 {2}90 km, 1h50 {2}replaced \d{4}-\d\d-\d\d by "50 km longer"\n {2}v2 {2}140 km, 2h50 {2}current$/,
  );
  assert.match(
    formatRideDayPage(store.listRideDays(), String),
    /^2099-05-02 Sat 09:00 {2}#1 {2}Monts de Flandre {2}\| {2}140 km, 2h50 {2}\| {2}planned, route changed: refresh it$/m,
  );
});

test("versions: restore brings an old design back as a new version; nothing is lost", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(original());
  store.reviseRoadbook(id, longer, "50 km longer");
  store.rateLeg(id, 2, 0, "cobbles");
  assert.equal(restoreVersion(store, id, 1), 3);
  const back = store.findRide(String(id))!;
  assert.deepEqual([back.distanceKm, back.legs.length, back.legs[1]!.mainRoads], [90, 2, ["D 916"]]);
  assert.deepEqual(
    store.listVersions(id).map((v) => [v.version, v.change, v.design.distanceKm]),
    [
      [1, "50 km longer", 90],
      [2, "restored version 1", 140],
    ],
  );
  assert.deepEqual(
    store.listRoadRatings().map((r) => [r.road, r.rating, r.reason, r.cells.length > 0]),
    [["D 7", 0, "cobbles", true]],
    "a rated leg of the replaced design stays as a rating of that road",
  );
  assert.throws(() => restoreVersion(store, id, 7), /has no version 7; its earlier versions: 1, 2/);
});

test("versions: a copy is a separate roadbook, a variant of its origin, without its ratings or rides", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(original());
  store.rateLeg(id, 1, 5, "great bends");
  const copy = copyRoadbook(store, id, "Flandre short");
  const saved = store.findRide(String(copy))!;
  assert.deepEqual([saved.name, saved.parentId, saved.distanceKm, saved.rideDate], ["Flandre short", id, 90, null]);
  assert.deepEqual(
    saved.legs.map((l) => l.rating),
    [null, null],
  );
  assert.equal(copyRoadbook(store, id).toString(), "3");
  assert.equal(store.findRide("3")!.name, "Monts de Flandre (copy)");
});

test("versions: a ride done keeps its route and is shown with it; a past planned ride asks; keep goes back", () => {
  const store = new Store(":memory:");
  const id = store.saveRide(original());
  store.planDay(id, "2099-05-09", "10:00");
  store.planDay(id, "2020-01-05", "09:00");
  store.reviseRoadbook(id, longer, "50 km longer");
  assert.deepEqual(
    rides(store),
    [
      ["2099-05-02", "planned", 2, 1],
      ["2099-05-09", "planned", 2, 1],
      ["2020-01-05", "planned", 1, 0],
    ],
    "a ride whose date has passed keeps its version",
  );
  const past = store.findRideOn(id, "2020-01-05")!;
  const shown = store.rideView(id, past.id)!;
  assert.deepEqual([shown.distanceKm, shown.legs[0]!.to, shown.rideDate], [90, "Cassel", "2020-01-05"]);
  assert.equal(store.findRide(String(id))!.distanceKm, 140, "the roadbook itself is the new design");
  assert.match(formatRideDayPage(store.listRideDays(), String), /^2099-05-09 Sat 10:00 .* 140 km, 2h50 /m);
  assert.match(
    formatRideDayPage(store.listRideDays(), String),
    /^2020-01-05 Sun 09:00 {2}#1 {2}Monts de Flandre {2}\| {2}90 km, 1h50 {2}\| {2}date passed: ridden or cancelled\?$/m,
  );
  assert.equal(
    followingRides(store, id),
    'Planned rides now following the new route (refresh before riding): 2099-05-09, 2099-05-02. Rides already done keep their route. To keep one as it was: npm run rides -- keep 1 <day>, or "keep Saturday\'s ride on the previous version".',
  );
  const saturday = store.findRideOn(id, "2099-05-02")!;
  assert.equal(store.keepPreviousVersion(saturday.id), 1);
  assert.equal(store.rideView(id, saturday.id)!.distanceKm, 90, "kept as it was");
  assert.match(followingRides(store, id)!, /: 2099-05-09\. /);
  assert.throws(() => store.keepPreviousVersion(saturday.id), /no earlier version/);
  store.rateRideDay(past.id, 3, null);
  assert.throws(() => store.keepPreviousVersion(past.id), /This ride is ridden/);
});
