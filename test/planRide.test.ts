import assert from "node:assert/strict";
import { test } from "node:test";
import { routeCells } from "../src/geometry.ts";
import { parseDeparture, parsePlanRide, parseRideDay, planRideFrom } from "../src/planRide.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { Store } from "../src/store.ts";
import { installFakeServices } from "./helpers/fakeServices.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

installFakeServices();

// Wednesday 7 October 2026, 08:00 local time.
const NOW = new Date(2026, 9, 7, 8);

test("plan ride: a day in the rider's words", () => {
  const day = (text: string) => parseRideDay(text, NOW);
  assert.equal(day("saturday"), "2026-10-10");
  assert.equal(day("Next Saturday"), "2026-10-10");
  assert.equal(day("samedi"), "2026-10-10");
  assert.equal(day("wednesday"), "2026-10-14", "today's weekday alone means a week on");
  assert.equal(day("this wednesday"), "2026-10-07");
  assert.equal(day("today"), "2026-10-07");
  assert.equal(day("tomorrow"), "2026-10-08");
  assert.equal(day("2026-12-24"), "2026-12-24");
  assert.equal(day("17/10"), "2026-10-17");
  assert.equal(day("01/02"), "2027-02-01", "a date gone this year is next year's");
  assert.equal(day("31/02"), null);
  assert.equal(day("someday"), null);
});

test("plan ride: a departure time in the rider's words", () => {
  assert.equal(parseDeparture("9"), "09:00");
  assert.equal(parseDeparture("9:30"), "09:30");
  assert.equal(parseDeparture("9h30"), "09:30");
  assert.equal(parseDeparture("9h"), "09:00");
  assert.equal(parseDeparture("2pm"), "14:00");
  assert.equal(parseDeparture("12am"), "00:00");
  assert.equal(parseDeparture("25"), null);
  assert.equal(parseDeparture("9:75"), null);
});

test("plan ride: the sentence names a roadbook and a day, and nothing else", () => {
  const parse = (text: string) => parsePlanRide(text, NOW);
  assert.deepEqual(parse("plan a ride from roadbook 7 on Saturday at 9"), {
    roadbook: "7",
    date: "2026-10-10",
    departure: "09:00",
  });
  assert.deepEqual(parse("Plan a ride from roadbook #12 next saturday."), {
    roadbook: "12",
    date: "2026-10-10",
    departure: null,
  });
  assert.deepEqual(parse("plan roadbook 3 tomorrow 9h30"), { roadbook: "3", date: "2026-10-08", departure: "09:30" });
  assert.deepEqual(
    parse("plan a ride on Saturday at 9:30"),
    { roadbook: null, date: "2026-10-10", departure: "09:30" },
    "no roadbook: the one in view, if any",
  );
  assert.equal(parse("plan a ride on Saturday, 50 km longer"), null, "a change is for the planner");
  assert.equal(parse("plan a twisty loop from Thuin on Saturday"), null, "a new ride is for the planner");
  assert.equal(parse("show roadbook 7"), null);
});

function library(): Store {
  const store = new Store(":memory:");
  const A = { lat: 50.6, lon: 3.06 };
  const B = { lat: 50.8, lon: 2.49 };
  const shapes = [encodePolyline(bentLine(A, B, 40, 0.02)), encodePolyline(bentLine(B, A, 40, -0.02))];
  store.saveRide({
    name: "Monts de Flandre",
    parentId: null,
    home: "Lille",
    rideDate: "2026-10-03",
    departure: "10:00",
    distanceKm: 90,
    ridingMinutes: 110,
    waypoints: ["Lille", "Cassel"],
    roundTrip: true,
    speedLimits: {},
    preferences: DEFAULT_PREFERENCES,
    request: "a loop",
    itinerary: "text",
    mapsUrl: "https://maps",
    cells: routeCells(shapes),
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
        fromCoords: `${A.lat},${A.lon}`,
        toCoords: `${B.lat},${B.lon}`,
        distanceKm: 45,
        ridingMinutes: 55,
        mainRoads: ["D 933"],
      },
      {
        seq: 2,
        from: "Cassel",
        to: "Lille",
        fromCoords: `${B.lat},${B.lon}`,
        toCoords: `${A.lat},${A.lon}`,
        distanceKm: 45,
        ridingMinutes: 55,
        mainRoads: ["D 916"],
      },
    ],
  });
  return store;
}

const rides = (store: Store) =>
  store.database
    .prepare("SELECT ride_date, departure, status FROM rides ORDER BY id")
    .all()
    .map((r) => Object.values(r));

test("plan ride: a ride added to the roadbook on that day, its day gathered, the roadbook untouched", async () => {
  const store = library();
  const before = store.findRide("1")!;
  const text = await planRideFrom(store, "1", "2026-10-10", "9:30", NOW);
  assert.match(
    text,
    /^Ride planned from roadbook #1 "Monts de Flandre" on 2026-10-10, leaving at 09:30\. The roadbook is unchanged\./,
  );
  assert.match(text, /Briefing for the ride of 2026-10-10 from roadbook #1/);
  assert.match(text, /(GO|NO-GO)/);
  assert.match(text, /Navigation \(with the stops\):\n {2}https:\/\/www\.google\.com\/maps\/dir\//);
  assert.deepEqual(rides(store), [
    ["2026-10-03", "10:00", "planned"],
    ["2026-10-10", "09:30", "planned"],
  ]);
  assert.equal(store.listRoadbooks().total, 1, "no copy");
  const after = store.findRide("1")!;
  assert.equal(after.rideDate, "2026-10-10", "the coming ride is the one shown");
  assert.ok(after.extras?.stopPlan, "the day's stop plan is stored on that ride");
  assert.deepEqual(
    { ...after, rideDate: null, departure: null, extras: null, rideDayId: null },
    { ...before, rideDate: null, departure: null, extras: null, rideDayId: null },
    "the design is the same",
  );

  const again = await planRideFrom(store, "Monts de Flandre", "2026-10-10", null, NOW);
  assert.match(again, /^Ride updated .* leaving at 09:30/, "the same day again updates it, keeping its departure");
  assert.equal(rides(store).length, 2);
  await planRideFrom(store, "1", "2026-10-11", null, NOW);
  assert.deepEqual(rides(store).at(-1), ["2026-10-11", "09:30", "planned"], "departure from the shown ride");
});

test("plan ride: refused for a past day, an unknown roadbook or a wrong time", async () => {
  const store = library();
  await assert.rejects(planRideFrom(store, "1", "2026-10-06", null, NOW), /2026-10-06 is in the past/);
  await assert.rejects(planRideFrom(store, "9", "2026-10-10", null, NOW), /No roadbook matches "9"/);
  await assert.rejects(planRideFrom(store, "1", "Saturday", null, NOW), /"Saturday" is not a date/);
  await assert.rejects(planRideFrom(store, "1", "2026-10-10", "noon", NOW), /"noon" is not a time/);
  assert.equal(rides(store).length, 1, "nothing added");
});
