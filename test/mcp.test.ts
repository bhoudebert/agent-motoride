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

async function connect(db: string, elicitation: boolean) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", RIDE_DB: db, RIDE_SCOUTS: "0" };
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
    assert.match(form.message, /Rate the roads of ride #1/);
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
    assert.match(await planAndSave(earlier), /Saved as ride #2/);
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
    assert.match(asked[0]!, /same roads as saved ride #2[\s\S]*Save it anyway/);
    assert.match(await planAndSave(today), /Saved as ride #3/);
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
    assert.match(edit, /This concerns saved ride #1 "Straight north"/);
  } finally {
    await client.close();
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
    await call("getWeather", { location: "Lille", date: "2026-10-10" });
    await call("searchRoads", { location: "Cassel" });
    const routeId = JSON.parse(await call("calculateTrip", loop)).routeId;
    await call("importRoute", { file: gpx });
    await call("getTraffic", { waypoints: loop.waypoints, departAt: "2026-10-10T09:00:00" });
    await call("getDaylight", { location: "Lille", date: "2026-10-10" });
    await call("getSpeedCameras", { routeId });
    await call("findStops", { routeId });
    await call("planStops", { routeId, departure: "09:00", date: "2026-10-10" });
    await call("checkConditions", { routeId, date: "2026-10-10", departure: "09:00" });
    assert.match(
      await call("scoutAreas", {
        areas: [{ name: "Flandre", location: "Cassel" }],
        rideDate: "2026-10-10",
        departure: "09:00",
        maxDistanceKm: 200,
        maxRidingMinutes: null,
        constraints: "dry",
      }),
      /Scouts are unavailable/,
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
      /Saved as ride #2/,
    );
    await call("exportGpx", { rideId: 2, file: join(dir, "ride.gpx") });
    await call("exportMarkdown", { ride: "2", file: join(dir, "ride.md") });
    await call("refreshRide", { ride: "2", stopsOnly: true });
    await call("rideBriefing", { ride: "2" });
    await call("showRide", { ride: "2" });
    await call("addRideNote", { text: "nice bends", ride: "2" });
    await call("reviewRide", { ride: "1" });
    await call("listRides", {});
    await call("planningGuide", { request: "plan me a ride" });

    // A new tool must come with its line above.
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual([...called].sort(), listed);
  } finally {
    await client.close();
  }
});
