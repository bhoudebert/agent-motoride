import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { addRideNote } from "../src/feedback.ts";
import { routeCells } from "../src/geometry.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { copyRoadbook } from "../src/library.ts";
import { Store } from "../src/store.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const shapes = [encodePolyline(bentLine({ lat: 50.4, lon: 3 }, { lat: 50.6, lon: 3 }, 200))];

/** A library with one ride ridden today and one note left during it. */
function library(): string {
  const path = join(mkdtempSync(join(tmpdir(), "ride-mcp-")), "rides.db");
  const store = new Store(path);
  const today = new Intl.DateTimeFormat("en-CA").format(Date.now());
  const id = store.saveRide({
    name: "Straight north",
    parentId: null,
    home: "Lille",
    rideDate: today,
    departure: "09:00",
    distanceKm: 22.2,
    ridingMinutes: 30,
    waypoints: ["Lille", "Cassel"],
    roundTrip: false,
    speedLimits: {},
    preferences: DEFAULT_PREFERENCES,
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
        from: "Lille",
        to: "Cassel",
        fromCoords: "50.4,3",
        toCoords: "50.6,3",
        distanceKm: 22.2,
        ridingMinutes: 30,
        mainRoads: [],
      },
    ],
  });
  addRideNote(store, { ride: String(id), text: "last 10 min awesome", at: new Date(`${today}T09:20:00`) });
  store.close();
  return path;
}

async function connect(db: string, elicitation: boolean, extra: Record<string, string> = {}) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", RIDE_DB: db, RIDE_SCOUTS: "0", ...extra };
  const client = new Client({ name: "test", version: "0" }, { capabilities: elicitation ? { elicitation: {} } : {} });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "./test/helpers/fakePreload.ts", "src/mcp.ts"],
      cwd: root,
      env,
      stderr: "pipe",
    }),
  );
  return client;
}

const textOf = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0]!.text;

test("mcp: the review asks the rider in a form and stores their answer", async () => {
  const db = library();
  const client = await connect(db, true);
  const asked: unknown[] = [];
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    asked.push(request.params);
    return { action: "accept", content: { rating_1: 4, dismiss_1: false } };
  });
  try {
    const result = textOf(await client.callTool({ name: "reviewRide", arguments: { ride: "1" } }));
    const form = asked[0] as { message: string; requestedSchema: { properties: Record<string, { default?: number }> } };
    assert.match(form.message, /Rate the roads of roadbook #1/);
    assert.equal(form.requestedSchema.properties.rating_1!.default, 5, "proposal from 'awesome' filled in");
    assert.match(result, /The rider's answers:\nRated 4:/);
  } finally {
    await client.close();
  }
  const store = new Store(db);
  assert.equal(store.listRoadRatings()[0]!.rating, 4);
  assert.equal(store.listNotes().length, 0);
  store.close();
});

test("mcp: a closed form stores nothing; a client without forms gets the review to confirm in chat", async () => {
  const db = library();
  const withForms = await connect(db, true);
  withForms.setRequestHandler(ElicitRequestSchema, async () => ({ action: "cancel" }));
  try {
    const closed = textOf(await withForms.callTool({ name: "reviewRide", arguments: { ride: "1" } }));
    assert.match(closed, /nothing stored, the notes stay pending/);
  } finally {
    await withForms.close();
  }
  const plain = await connect(db, false);
  try {
    const review = textOf(await plain.callTool({ name: "reviewRide", arguments: { ride: "1" } }));
    assert.match(review, /proposed rating 5/);
    assert.doesNotMatch(review, /rider's answers/);
  } finally {
    await plain.close();
  }
  const store = new Store(db);
  assert.equal(store.listRoadRatings().length, 0);
  assert.equal(store.listNotes().length, 1);
  store.close();
});

test("mcp: saved rides and rated roads are published as resources", async () => {
  const db = library();
  const client = await connect(db, false);
  try {
    const listed = await client.listResources();
    const uris = listed.resources.map((r) => r.uri);
    for (const uri of ["ride://library", "ride://roads/rated", "ride://ride/1"]) assert.ok(uris.includes(uri), uri);
    const ride = await client.readResource({ uri: "ride://ride/1" });
    assert.match((ride.contents[0] as { text: string }).text, /Straight north/);
    const rated = await client.readResource({ uri: "ride://roads/rated" });
    assert.equal((rated.contents[0] as { text: string }).text, "Nothing rated yet.");
  } finally {
    await client.close();
  }
});

test("mcp: a large library is attached 20 roadbooks at a time; any one still opens by its number", async () => {
  const db = library();
  const store = new Store(db);
  for (let i = 0; i < 22; i++) copyRoadbook(store, 1, `Copy ${i + 1}`);
  store.close();
  const client = await connect(db, false);
  try {
    const library = ((await client.readResource({ uri: "ride://library" })).contents[0] as { text: string }).text.split(
      "\n",
    );
    assert.equal(library.filter((line) => line.startsWith("#")).length, 20);
    assert.match(library[0]!, /^#23 {2}Copy 22 \(from #1\)/, "newest first");
    assert.equal(library.at(-1), "Page 1 of 2 (23 roadbooks). Next: call listRoadbooks with page 2");
    const offered = (await client.listResources()).resources.filter((r) => r.uri.startsWith("ride://ride/"));
    assert.equal(offered.length, 20);
    assert.match(
      ((await client.readResource({ uri: "ride://ride/1" })).contents[0] as { text: string }).text,
      /Straight north/,
    );
  } finally {
    await client.close();
  }
});

test("mcp: saving a repeat of an earlier ride asks the rider; yes keeps a copy, no keeps nothing", async () => {
  const db = library();
  const loop = { waypoints: ["Lille", "Cassel", "Mont des Cats"], roundTrip: true };
  const planAndSave = async (client: Client) => {
    await client.callTool({ name: "rideSettings", arguments: { home: "Lille" } });
    const routeId = JSON.parse(textOf(await client.callTool({ name: "calculateTrip", arguments: loop }))).routeId;
    return textOf(
      await client.callTool({
        name: "saveRide",
        arguments: { routeId, name: "Flandre", rideDate: null, departure: null, itinerary: "135 km", request: "loop" },
      }),
    );
  };
  // An earlier session saved the loop.
  const earlier = await connect(db, false);
  try {
    assert.match(await planAndSave(earlier), /Saved as roadbook #2/);
  } finally {
    await earlier.close();
  }
  // Today's session plans the same loop: the rider is asked, twice, and answers no then yes.
  const today = await connect(db, true);
  const answers = [false, true];
  const asked: string[] = [];
  today.setRequestHandler(ElicitRequestSchema, async (request) => {
    asked.push((request.params as { message: string }).message);
    return { action: "accept", content: { save: answers.shift() } };
  });
  try {
    assert.match(await planAndSave(today), /chose not to keep a copy/);
    assert.match(
      asked[0]!,
      /same roads as roadbook #2 "Flandre"\. Not saved\. Ride it again instead \("plan a ride from roadbook 2 on Saturday"\)[\s\S]*Save it anyway/,
    );
    assert.match(await planAndSave(today), /Saved as roadbook #3/);
  } finally {
    await today.close();
  }
  // Without forms, the model is told to ask in chat, as before.
  const plain = await connect(db, false);
  try {
    assert.match(await planAndSave(plain), /Not saved: .*Tell the rider/);
  } finally {
    await plain.close();
  }
});

test("mcp: a delete is asked in a dialog; no keeps everything, yes deletes, road ratings stay", async () => {
  const db = library();
  const client = await connect(db, true);
  const answers = [false, true];
  const asked: string[] = [];
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    asked.push((request.params as { message: string }).message);
    return { action: "accept", content: { delete: answers.shift() } };
  });
  try {
    const remove = async () => textOf(await client.callTool({ name: "deleteRoadbook", arguments: { roadbook: "1" } }));
    assert.equal(await remove(), "Not deleted: the rider said no.");
    assert.match(asked[0]!, /^Delete roadbook #1 "Straight north", its 1 ride and 1 note\?/);
    assert.match(await remove(), /^Deleted roadbook #1 "Straight north"\.$/);
    const list = textOf(await client.callTool({ name: "listRoadbooks", arguments: {} }));
    assert.doesNotMatch(list, /#1 /);
  } finally {
    await client.close();
  }
});

test("mcp: plain words get the full guidance, in any client", async () => {
  const client = await connect(library(), false);
  try {
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /Plain words are enough, slash commands are only shortcuts/);
    assert.match(instructions, /before planning any new ride asked in plain words, in any client, call planningGuide/);
    const guide = textOf(
      await client.callTool({ name: "planningGuide", arguments: { request: "plan me a ride this Saturday" } }),
    );
    assert.match(guide, /^You plan one-day motorcycle rides/);
    assert.match(guide, /Rider's request: plan me a ride this Saturday/);
    const edit = textOf(
      await client.callTool({ name: "planningGuide", arguments: { request: "50 km longer", ride: "1" } }),
    );
    assert.match(edit, /This concerns roadbook #1 "Straight north"/);
  } finally {
    await client.close();
  }
});

test("mcp: with API scouts off, the client is told to scout with parallel subagents; with them on, nothing changes", async () => {
  const off = await connect(library(), false);
  try {
    assert.match(off.getInstructions() ?? "", /scout 2-4 areas with parallel subagents as planningGuide explains/);
    const guide = textOf(await off.callTool({ name: "planningGuide", arguments: { request: "a twisty loop" } }));
    assert.match(guide, /start one subagent per area in the same turn/);
    assert.match(guide, /Scout brief:\nYou scout one area for a one-day motorcycle loop/);
    assert.ok(guide.indexOf("Scout brief:") < guide.indexOf("Rider's request: a twisty loop"), "with the rules");
    const edit = textOf(
      await off.callTool({ name: "planningGuide", arguments: { request: "50 km longer", ride: "1" } }),
    );
    assert.doesNotMatch(edit, /subagent/, "an edit is not scouted");
  } finally {
    await off.close();
  }
  // A placeholder key: nothing is called at connection, so it never reaches the API.
  const on = await connect(library(), false, { RIDE_SCOUTS: "1", ANTHROPIC_API_KEY: "test-placeholder" });
  try {
    assert.match(on.getInstructions() ?? "", /then scoutAreas with 2-4 areas/);
    assert.doesNotMatch(on.getInstructions() ?? "", /subagent/);
    const guide = textOf(await on.callTool({ name: "planningGuide", arguments: { request: "a twisty loop" } }));
    assert.doesNotMatch(guide, /subagent/);
  } finally {
    await on.close();
  }
});

test("mcp: every tool declares all four hints, as the server means them", async () => {
  const client = await connect(library(), false);
  try {
    const tools = (await client.listTools()).tools;
    for (const tool of tools) {
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name} ${hint}`);
      }
    }
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations!]));
    assert.equal(hints.calculateTrip!.readOnlyHint, true);
    assert.equal(hints.listSavedRides!.openWorldHint, false, "the library is local");
    assert.equal(hints.saveRide!.readOnlyHint, false);
    assert.equal(hints.saveRide!.idempotentHint, false, "saving twice stores twice");
    assert.equal(hints.exportGpx!.destructiveHint, true, "may overwrite a file");
    assert.equal(hints.showRide!.openWorldHint, false);
  } finally {
    await client.close();
  }
});

test("mcp: every tool answers when called by name through a client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ride-tools-"));
  const gpx = join(dir, "shared.gpx");
  writeFileSync(
    gpx,
    `<gpx><trk><name>Club ride</name><trkseg>${Array.from({ length: 30 }, (_, i) => `<trkpt lat="${50.63 + i * 0.004}" lon="${3.05 - i * 0.012}"/>`).join("")}</trkseg></trk></gpx>`,
  );
  const client = await connect(library(), false);
  const called = new Set<string>();
  const call = async (name: string, args: Record<string, unknown>) => {
    called.add(name);
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    assert.ok(!result.isError, `${name} failed: ${result.content[0]?.text}`);
    return result.content[0]!.text;
  };
  const loop = { waypoints: ["Lille", "Cassel", "Mont des Cats"], roundTrip: true };
  try {
    await call("rideSettings", { home: "Lille" });
    await call("listSavedRides", {});
    assert.match(await call("recallArea", { location: "Lille", query: "Flandre" }), /"radiusKm":40/);
    await call("getWeather", { location: "Lille", date: "2026-10-10" });
    await call("searchRoads", { location: "Cassel" });
    const routeId = JSON.parse(await call("calculateTrip", loop)).routeId;
    await call("importRoute", { file: gpx });
    await call("getTraffic", { waypoints: loop.waypoints, departAt: "2026-10-10T09:00:00" });
    await call("getDaylight", { location: "Lille", date: "2026-10-10" });
    await call("getSpeedCameras", { routeId });
    await call("findStops", { routeId });
    // Any day from tomorrow: a departure already past is refused.
    const ahead = new Intl.DateTimeFormat("en-CA").format(Date.now() + 2 * 86_400_000);
    await call("planStops", { routeId, departure: "9:00", date: ahead });
    const past = await client.callTool({
      name: "planStops",
      arguments: { routeId, departure: "09:00", date: "2026-10-01" },
    });
    assert.ok(past.isError);
    assert.match(textOf(past), /Departure 2026-10-01 09:00 is already past \(now /);
    await call("checkConditions", { routeId, date: "2026-10-10", departure: "09:00" });
    assert.match(
      await call("scoutAreas", {
        areas: [{ name: "Flandre", location: "Cassel" }],
        rideDate: "2026-10-10",
        departure: "09:00",
        maxDistanceKm: 200,
        maxRidingMinutes: null,
        constraints: "dry",
        start: "50.3397,4.2869",
      }),
      /API scouts are off here \(disabled by RIDE_SCOUTS=0\)[\s\S]*"brief":"Area to scout: Flandre \(around Cassel\)\.\\nStart and end point of the loop: 50\.3397,4\.2869/,
    );
    await call("checkItinerary", { routeId, request: "under 200 km", itinerary: "Loop, 135 km." });
    assert.match(
      await call("saveRide", {
        routeId,
        name: "Flandre",
        rideDate: "2026-10-10",
        departure: "09:00",
        itinerary: "135 km",
        request: "loop",
      }),
      /Saved as roadbook #2/,
    );
    // Saving again changes roadbook 2 in place; restoring brings version 1 back as version 3.
    assert.match(
      await call("saveRide", {
        routeId,
        name: "Flandre",
        rideDate: null,
        departure: null,
        itinerary: "135 km, v2",
        request: "tweak",
      }),
      /^Roadbook #2 changed in place, now version 2; the previous version is kept/,
    );
    assert.match(
      await call("restoreRoadbook", { roadbook: "2", version: 1 }),
      /^Roadbook #2 is back to version 1, saved as version 3/,
    );
    assert.match(
      await call("copyRoadbook", { roadbook: "2", name: "Flandre bis" }),
      /^Copied roadbook #2 as #3 "Flandre bis"/,
    );
    await call("exportGpx", { rideId: 2, file: join(dir, "ride.gpx") });
    await call("exportMarkdown", { ride: "2", file: join(dir, "ride.md") });
    await call("refreshRide", { ride: "2", stopsOnly: true });
    await call("rideBriefing", { ride: "2" });
    await call("showRide", { ride: "2" });
    await call("rateRide", { ride: "2", rating: 4, note: "nice" });
    assert.match(
      await call("rateRide", { ride: "2", rating: 2, day: "2026-10-10", note: "cold" }),
      /^Rated the ride of 2026-10-10 on roadbook #2 2\/5; the roads keep their own rating\./,
    );
    assert.match(
      await call("rideBriefing", { ride: "2", date: "2026-10-10" }),
      /^Briefing for the ride of 2026-10-10 from roadbook #2 /,
    );
    called.add("showRideMap");
    const map = (await client.callTool({ name: "showRideMap", arguments: { ride: "2" } })) as {
      isError?: boolean;
      content: Array<{ type: string; mimeType?: string; data?: string }>;
    };
    assert.ok(!map.isError);
    assert.equal(map.content[0]!.type, "image");
    assert.equal(map.content[0]!.mimeType, "image/png");
    assert.ok(Buffer.from(map.content[0]!.data!, "base64").subarray(1, 4).toString() === "PNG");
    await call("addRideNote", { text: "nice bends", ride: "2" });
    await call("reviewRide", { ride: "1" });
    assert.match(await call("listRides", {}), /#\d+ {2}.*\| {2}(planned|ridden)[\s\S]*Page 1 of 1 \(\d+ rides?\)\.$/);
    assert.match(await call("listRoadbooks", { page: 1 }), /^#3 {2}[\s\S]*Page 1 of 1 \(3 roadbooks\)\.$/);
    assert.match(
      await call("listRoadbooks", { page: 3 }),
      /Page 3 does not exist: the last is page 1 \(3 roadbooks\)\./,
    );
    assert.match(
      await call("planRide", { roadbook: "1", date: "tomorrow", departure: "9:30" }),
      /^Ride planned from roadbook #1 .* leaving at 09:30\. The roadbook is unchanged\./,
    );
    assert.match(await call("listRoadbooks", {}), /^#3 [\s\S]*#1 .*2 rides/m, "a ride added, no copy");
    assert.match(
      await call("cancelRide", { roadbook: "1", date: "tomorrow" }),
      /^Cancelled the ride of .* stays in the list/,
    );
    assert.match(
      await call("deleteRide", { roadbook: "1", date: "tomorrow" }),
      /^Delete the ride of .* \(cancelled\) from roadbook #1 .*\nNothing deleted yet\. Ask the rider/,
      "without a dialog: the question first, nothing deleted",
    );
    assert.match(await call("deleteRide", { roadbook: "1", date: "tomorrow", confirm: true }), /^Deleted the ride of /);
    assert.match(await call("deleteRoadbook", { roadbook: "2" }), /^Delete roadbook #2 .*\?[\s\S]*Nothing deleted yet/);
    assert.match(await call("deleteRoadbook", { roadbook: "2", confirm: true }), /^Deleted roadbook #2 /);
    await call("planningGuide", { request: "plan me a ride" });

    // A new tool must come with its line above.
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual([...called].sort(), listed);
  } finally {
    await client.close();
  }
});

test("mcp: rating a ride or a leg is stored and counts at once in the next routed trip", async () => {
  const db = library();
  const client = await connect(db, false);
  const loop = { waypoints: ["Lille", "Cassel", "Mont des Cats"], roundTrip: true };
  try {
    await client.callTool({ name: "rideSettings", arguments: { home: "Lille" } });
    const routeId = JSON.parse(textOf(await client.callTool({ name: "calculateTrip", arguments: loop }))).routeId;
    await client.callTool({
      name: "saveRide",
      arguments: { routeId, name: "Flandre", rideDate: null, departure: null, itinerary: "135 km", request: "loop" },
    });
    assert.match(
      textOf(await client.callTool({ name: "rateRide", arguments: { ride: "2", rating: 0, note: "never again" } })),
      /Rated #2 "Flandre" 0\/5/,
    );
    // The same session routes the same roads again: they now count as rated never again.
    const again = JSON.parse(textOf(await client.callTool({ name: "calculateTrip", arguments: loop })));
    assert.match(again.ratedRoads.verdict, /^AVOID/);
    assert.match(
      textOf(await client.callTool({ name: "rateRide", arguments: { ride: "Flandre", leg: 2, rating: 5 } })),
      /Rated leg 2 \(.+\) of #2 "Flandre" 5\/5/,
    );
    const bad = (await client.callTool({ name: "rateRide", arguments: { ride: "2", leg: 9, rating: 3 } })) as {
      isError?: boolean;
    };
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
  const store = new Store(db);
  const ride = store.findRide("2")!;
  assert.equal(ride.rating, 0);
  assert.equal(ride.notes, "never again");
  assert.equal(ride.legs[1]!.rating, 5);
  store.close();
});
