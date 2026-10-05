import assert from "node:assert/strict";
import { test } from "node:test";
import { finalText, installFakeServices, toolUse } from "./helpers/fakeServices.ts";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RIDE_MODEL = "claude-sonnet-5-5";
const api = installFakeServices();
const { openRide } = await import("../src/agent.ts");
const { Store } = await import("../src/store.ts");
const { saveCurrentRide } = await import("../src/library.ts");

const quiet = () => {
  api.requests = [];
  const log = console.log;
  console.log = () => undefined;
  return () => (console.log = log);
};

test("planner: routes, presents a scout's route, saves it; usage and trace are kept", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  try {
    api.script = [
      toolUse("scoutAreas", {
        areas: [{ name: "Flandre", location: "Cassel" }],
        rideDate: "2026-10-10",
        departure: "09:00",
        maxDistanceKm: 250,
        maxRidingMinutes: 180,
        constraints: "dry",
      }),
      // The scout's own session:
      toolUse("calculateTrip", { waypoints: ["Lille", "Cassel", "Mont des Cats"], roundTrip: true }),
      finalText(
        JSON.stringify({
          area: "Flandre",
          found: true,
          routeId: "r1",
          waypoints: ["Lille", "Cassel", "Mont des Cats"],
          distanceKm: 135,
          ridingMinutes: 110,
          openRoadPct: 70,
          pct50: 20,
          pct30: 1,
          weather: "dry",
          verdict: "ok",
        }),
      ),
      // Back in the planner:
      finalText(
        JSON.stringify({
          message: "Itinerary text",
          ride: { routeId: "r1", rideDate: "2026-10-10", departure: "09:00", name: "Flandre loop" },
        }),
      ),
    ];
    const session = await openRide({ home: "Lille", store });
    await session.send("ride saturday");
    const current = session.current();
    assert.ok(current, "an itinerary is on the table");
    assert.equal(current!.route.id, "r1");
    assert.equal(current!.title, "Flandre loop");
    assert.equal(current!.route.trip.result.legs.length, 3);
    // Scout tokens count in the session's usage.
    assert.equal(session.usage().modelCalls, 4);
    // The first request carried the situation, the schema and the tools.
    assert.ok(String(api.requests[0].messages[0].content).includes("Start and end point"));
    assert.equal(api.requests[0].output_config.format.type, "json_schema");
    assert.ok(api.requests[0].tools.some((t: any) => t.name === "scoutAreas"));
    assert.equal(
      api.requests[1].tools.some((t: any) => t.name === "scoutAreas"),
      false,
      "scouts have no scouts",
    );

    const id = saveCurrentRide(session.context, current!, {
      request: "ride saturday",
      parentId: null,
      home: "Lille",
      usage: session.usage(),
    });
    const saved = store.findRide(String(id))!;
    assert.equal(saved.distanceKm, current!.route.trip.result.totalDistanceKm);
    assert.equal(saved.shapes!.length, 3);
    const trace = store.listTrace(session.context.runId);
    assert.ok(trace.some((e) => e.scope === "scout:Flandre" && e.kind === "tool"));
    assert.ok(trace.some((e) => e.scope === "main" && e.kind === "answer"));
  } finally {
    restore();
    store.close();
  }
});

test("planner: an answer naming an unknown route is shown but not saveable", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  try {
    api.script = [
      finalText(
        JSON.stringify({ message: "Hello", ride: { routeId: "r99", rideDate: null, departure: null, name: "ghost" } }),
      ),
    ];
    const session = await openRide({ home: "Lille", store });
    await session.send("hi");
    assert.equal(session.current(), undefined);
  } finally {
    restore();
    store.close();
  }
});

test("planner: motorways stay excluded when forbidden, even if the model asks", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  try {
    api.script = [
      toolUse("calculateTrip", { waypoints: ["Lille", "Cassel"], roundTrip: true, avoidMotorways: false }),
      finalText(JSON.stringify({ message: "x", ride: null })),
    ];
    const session = await openRide({ home: "Lille", store });
    await session.send("go");
    const result = JSON.parse(api.requests[1].messages.at(-1).content[0].content);
    assert.equal(result.motorwaysPermitted, false);
    assert.equal(result.motorwaysAvoided, true);
  } finally {
    restore();
    store.close();
  }
});

test("saving a duplicate of a saved ride is refused unless forced; rated roads are reported", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  const { DuplicateRideError } = await import("../src/library.ts");
  try {
    const answer = finalText(
      JSON.stringify({
        message: "x",
        ride: { routeId: "r1", rideDate: "2026-10-10", departure: "09:00", name: "Loop" },
      }),
    );
    api.script = [toolUse("calculateTrip", { waypoints: ["Lille", "Cassel"], roundTrip: true }), answer];
    const first = await openRide({ home: "Lille", store });
    await first.send("go");
    const id = saveCurrentRide(first.context, first.current()!, { request: "go", parentId: null, home: "Lille" });
    store.rateRide(id, 0, "never again");

    api.script = [toolUse("calculateTrip", { waypoints: ["Lille", "Cassel"], roundTrip: true }), answer];
    const second = await openRide({ home: "Lille", store });
    await second.send("go again");
    const result = JSON.parse(api.requests.at(-1).messages.at(-1).content[0].content);
    assert.ok(result.savedRides.verdict.startsWith("DUPLICATE"));
    assert.ok(result.ratedRoads.verdict.startsWith("AVOID"), result.ratedRoads.verdict);
    assert.throws(
      () => saveCurrentRide(second.context, second.current()!, { request: "go again", parentId: null, home: "Lille" }),
      DuplicateRideError,
    );
    const forced = saveCurrentRide(second.context, second.current()!, {
      request: "go again",
      parentId: null,
      home: "Lille",
      force: true,
    });
    assert.ok(forced > id);
  } finally {
    restore();
    store.close();
  }
});

test("routed trips report cobbles and unpaved stretches by road", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  try {
    api.script = [
      toolUse("calculateTrip", { waypoints: ["Lille", "Cassel"], roundTrip: true }),
      finalText(JSON.stringify({ message: "x", ride: null })),
    ];
    const session = await openRide({ home: "Lille", store });
    await session.send("go");
    const result = JSON.parse(api.requests.at(-1).messages.at(-1).content[0].content);
    assert.ok(result.speedLimits.surface.roughPavedKm > 0);
    assert.equal(result.speedLimits.surface.unpavedKm, 0);
    assert.equal(result.speedLimits.surface.stretches[0].surface, "cobbles or setts");
    assert.equal(result.speedLimits.surface.stretches[0].road, "Rue de la Gare");
  } finally {
    restore();
    store.close();
  }
});
