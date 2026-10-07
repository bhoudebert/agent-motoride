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
          routeId: "flandre-r1",
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
          message: "Flandre loop, 135 km, dry.",
          ride: { routeId: "flandre-r1", rideDate: "2026-10-10", departure: "09:00", name: "Flandre loop" },
        }),
      ),
    ];
    const session = await openRide({ home: "Lille", store });
    await session.send("ride saturday");
    const current = session.current();
    assert.ok(current, "an itinerary is on the table");
    assert.equal(current!.route.id, "flandre-r1", "scout routes are numbered per area");
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

test("planner: scouts start from the place the request names, else from home", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  const scout = (start?: string) =>
    toolUse("scoutAreas", {
      areas: [{ name: "Fagne", location: "Chimay" }],
      rideDate: "2026-10-10",
      departure: "09:00",
      maxDistanceKm: 150,
      maxRidingMinutes: null,
      constraints: "twisty",
      ...(start ? { start } : {}),
    });
  const report = finalText(JSON.stringify({ area: "Fagne", found: false, waypoints: [], verdict: "none" }));
  try {
    api.script = [scout("50.3397,4.2869"), report, scout(), report, finalText(JSON.stringify({ message: "none" }))];
    const session = await openRide({ home: "Lille", store });
    await session.send("a loop from Thuin");
    const briefs = api.requests
      .map((r: any) => String(r.messages[0].content))
      .filter((c: string) => c.startsWith("Area to scout"));
    assert.match(briefs[0]!, /Start and end point of the loop: 50\.3397,4\.2869 \(50\.3397,4\.2869\)/);
    assert.match(briefs[1]!, /Start and end point of the loop: Lille/);
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
        message: "Loop, 85 km.",
        ride: { routeId: "r1", rideDate: "2026-10-10", departure: "09:00", name: "Loop" },
      }),
    );
    api.script = [toolUse("calculateTrip", { waypoints: ["Lille", "Cassel"], roundTrip: true }), answer];
    const first = await openRide({ home: "Lille", store });
    await first.send("go");
    const id = saveCurrentRide(first.context, first.current()!, { request: "go", parentId: null, home: "Lille" });
    store.rateRide(id, 0, "never again");

    // The second session presents the same loop: the code check sends it back once.
    api.script = [toolUse("calculateTrip", { waypoints: ["Lille", "Cassel"], roundTrip: true }), answer, answer];
    const second = await openRide({ home: "Lille", store });
    await second.send("go again");
    const correction = api.requests.at(-1).messages.at(-1).content;
    assert.match(String(correction), /Automatic check by code/);
    assert.match(String(correction), /repeat: \d+% of the roads of roadbook #1/);
    const result = JSON.parse(api.requests.at(-2).messages.at(-1).content[0].content);
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

test("planner: a tool called again and again with the same input answers from the first result", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  try {
    const daylight = toolUse("getDaylight", { location: "Lille", date: "2026-10-10" });
    api.script = [daylight, daylight, daylight, finalText(JSON.stringify({ message: "Sunset 19:09", ride: null }))];
    const session = await openRide({ home: "Lille", store });
    await session.send("when is sunset?");
    const results = api.requests.slice(1).map((r) => JSON.parse(r.messages.at(-1).content[0].content));
    assert.equal(results[0].sunset, results[1].sunset, "second identical call still looked up");
    assert.equal(results[1].repeatedCall, undefined);
    assert.equal(results[2].repeatedCall, 3);
    assert.match(results[2].note, /do not call getDaylight with this input again/);
    assert.equal(results[2].result.sunset, results[0].sunset);
  } finally {
    restore();
    store.close();
  }
});

test("planner: a model stuck on one call is stopped and made to answer with tools disabled", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  try {
    const daylight = toolUse("getDaylight", { location: "Lille", date: "2026-10-10" });
    api.script = [
      ...Array.from({ length: 6 }, () => daylight),
      finalText(JSON.stringify({ message: "Sunset at 19:09", ride: null })),
      daylight, // never reached
    ];
    const session = await openRide({ home: "Lille", store });
    await session.send("when is sunset?");
    assert.equal(api.script.length, 1, "stopped after the forced answer");
    const forced = api.requests.at(-1);
    assert.deepEqual(forced.tool_choice, { type: "none" });
    const note = forced.messages.at(-1).content;
    assert.equal(note[0].type, "tool_result");
    assert.equal(note[0].is_error, true);
    assert.match(note.at(-1).text, /give your final answer now/);
    const trace = store.listTrace(session.context.runId);
    assert.ok(trace.some((e) => e.kind === "error" && e.name === "stuck"));
    assert.ok(trace.some((e) => e.kind === "answer"));
    // The conversation stays valid for a follow-up: it ends with the forced answer.
    api.script = [finalText(JSON.stringify({ message: "ok", ride: null }))];
    await session.send("thanks");
    const followUp = api.requests.at(-1).messages;
    assert.equal(followUp.at(-2).role, "assistant");
  } finally {
    restore();
    store.close();
  }
});

test("planner: an attached image goes to the model as a picture; only its name is traced", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  const { readImage } = await import("../src/images.ts");
  try {
    api.script = [finalText(JSON.stringify({ message: "I read Lille, Cassel, Mont des Cats.", ride: null }))];
    const session = await openRide({ home: "Lille", store });
    const image = readImage(new URL("../evals/fixtures/sketch-loop.png", import.meta.url).pathname);
    await session.send("ride this", { images: [image] });
    const content = api.requests[0].messages[0].content;
    assert.equal(content[0].type, "image");
    assert.equal(content[0].source.media_type, "image/png");
    assert.equal(content[0].source.data, image.data);
    assert.equal(content[1].type, "text");
    assert.match(content[1].text, /^ride this/);
    const traced = store.listTrace(session.context.runId).find((e) => e.kind === "user")!;
    assert.deepEqual((traced.payload as { images: string[] }).images, ["sketch-loop.png"]);
    assert.ok(!JSON.stringify(traced.payload).includes(image.data.slice(0, 40)), "no picture in the database");
  } finally {
    restore();
    store.close();
  }
});

test("planner: a shared GPX file becomes a routed trip with a route id and its fidelity", async () => {
  const restore = quiet();
  const store = new Store(":memory:");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  try {
    const file = join(mkdtempSync(join(tmpdir(), "ride-import-")), "shared.gpx");
    const points = Array.from({ length: 50 }, (_, i) => ({ lat: 50.63 + i * 0.004, lon: 3.05 - i * 0.012 }));
    writeFileSync(
      file,
      `<gpx><trk><name>Club ride</name><trkseg>${points.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"/>`).join("")}</trkseg></trk></gpx>`,
    );
    api.script = [toolUse("importRoute", { file }), finalText(JSON.stringify({ message: "x", ride: null }))];
    const session = await openRide({ home: "Lille", store });
    await session.send("import my club's route");
    const result = JSON.parse(api.requests.at(-1).messages.at(-1).content[0].content);
    assert.equal(result.routeId, "r1");
    assert.equal(result.file.name, "Club ride");
    assert.equal(typeof result.fidelityPct, "number");
    assert.equal(result.motorwaysPermitted, false);
    assert.ok(result.waypoints.length >= 2);
    assert.ok(session.context.routes.has("r1"), "saveable like any routed trip");
  } finally {
    restore();
    store.close();
  }
});

test("routing: more locations than the router takes is refused with a clear reason", async () => {
  const { computeTrip } = await import("../src/tools/trip.ts");
  const nine = Array.from({ length: 9 }, () => "Lille");
  await assert.rejects(computeTrip({ waypoints: [...nine, "Cassel"], roundTrip: true }), /router takes 10 locations/);
});

test("routing: fast expressways are counted apart from motorways and country roads", async () => {
  const { computeTrip } = await import("../src/tools/trip.ts");
  const edge = (length: number, road_class: string, speed_limit: number | undefined, name: string, cc = "FR") => ({
    length,
    road_class,
    ...(speed_limit ? { speed_limit } : {}),
    density: 2,
    names: [name],
    begin_shape_index: 0,
    end_shape_index: 5,
    end_node: { admin_index: cc === "FR" ? 0 : 1 },
  });
  api.edges = [
    edge(10, "motorway", 130, "A 1"),
    edge(20, "trunk", 110, "N 41"), // voie express at 110: fast expressway
    edge(5, "trunk", 80, "N 17"), // former expressway now at 80: fine
    edge(5, "primary", 100, "N 4"), // a road posted at 100: fast
    edge(60, "secondary", undefined, "L 3", "DE"), // untagged German country road, default 100: not counted
  ];
  try {
    const trip = await computeTrip({ waypoints: ["Lille", "Cassel"] });
    const limits = trip.result.speedLimits as {
      motorwayKm: number;
      fastExpressway: { km: number; pct: number; longest: Array<{ road: string }> };
    };
    assert.equal(limits.motorwayKm, 10);
    assert.equal(limits.fastExpressway.km, 25);
    assert.deepEqual(
      limits.fastExpressway.longest.map((r) => r.road),
      ["N 41", "N 4"],
    );
    assert.equal(limits.fastExpressway.pct, 25);
  } finally {
    api.edges = undefined;
  }
});
