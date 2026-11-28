// Every MCP tool declares an outputSchema and returns structuredContent that matches it. The SDK client
// validates structuredContent against the server's outputSchema on callTool; each result is parsed here
// again against the schema this repository exports. The server runs as a child process with every
// external service faked (fakePreload), so nothing reaches the network or the model API.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { addRideNote } from "../src/feedback.ts";
import { routeCells } from "../src/geometry.ts";
import { keepRide } from "../src/recordedRides.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { RIDE_OUTPUT_SCHEMAS } from "../src/rideOutputSchemas.ts";
import { Store } from "../src/store.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const shapes = [encodePolyline(bentLine({ lat: 50.4, lon: 3 }, { lat: 50.6, lon: 3 }, 200))];
const today = new Intl.DateTimeFormat("en-CA").format(Date.now());

/** A library with one roadbook ridden today and one note left during it. */
function library(): { db: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ride-schemas-"));
  const db = join(dir, "rides.db");
  const store = new Store(db);
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
  return { db, dir };
}

async function connect(db: string, elicitation = false) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    RIDE_DB: db,
    RIDE_SCOUTS: "0",
    // Never the project's live key: the fakes answer the model API anyway.
    ANTHROPIC_API_KEY: "test-key-not-real",
  };
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

/** Call a tool, require success and structured content, and parse it with the exported schema. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: Array<{ type: string; text?: string }>;
  };
  assert.ok(!result.isError, `${name} failed: ${JSON.stringify(result.content)}`);
  assert.ok(result.structuredContent, `${name} returned no structuredContent`);
  const schema = (RIDE_OUTPUT_SCHEMAS as Record<string, { parse(value: unknown): unknown }>)[name];
  if (schema) schema.parse(result.structuredContent);
  return result.structuredContent as Record<string, any>;
}

test("outputSchemas: every tool declares an object outputSchema, and each hand-registered one has an exported schema", async () => {
  const { db } = library();
  const client = await connect(db);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length > 30);
    for (const tool of tools) {
      assert.equal(tool.outputSchema?.type, "object", `${tool.name} lacks an object outputSchema`);
    }
    const names = tools.map((t) => t.name);
    for (const name of Object.keys(RIDE_OUTPUT_SCHEMAS)) assert.ok(names.includes(name), `${name} is not registered`);
  } finally {
    await client.close();
  }
});

test("outputSchemas: library, reading and note tools return matching structured results", async () => {
  const { db, dir } = library();
  const client = await connect(db);
  try {
    const settings = await call(client, "rideSettings", { home: "Lille" });
    assert.match(settings.home.label, /^Lille/);
    assert.equal(settings.savedRides, 1);
    assert.match(settings.pendingNotes, /1 ride note/);

    const guide = await call(client, "planningGuide", { request: "a ride north" });
    assert.equal(guide.roadbookId, null);
    assert.equal((await call(client, "planningGuide", { request: "shorter", ride: "1" })).roadbookId, 1);
    assert.match((await call(client, "capabilities")).guide, /\S/);

    const roadbooks = await call(client, "listRoadbooks");
    assert.equal(roadbooks.roadbooks[0].id, 1);
    const rides = await call(client, "listRides");
    assert.equal(rides.rides[0].roadbookId, 1);
    assert.equal((await call(client, "listRecordedRides")).rides.length, 0);
    assert.equal((await call(client, "reviewRecordedRide")).status, "no_recorded_ride");

    const shown = await call(client, "showRide", { ride: "1" });
    assert.equal(shown.name, "Straight north");
    await call(client, "showRide", { ride: "1", date: today });
    const map = await call(client, "showRideMap", { ride: "1" });
    assert.equal(map.mimeType, "image/png");
    const md = await call(client, "exportMarkdown", { ride: "1", file: join(dir, "r.md"), includeContent: true });
    assert.match(md.markdown, /Straight north/);
    assert.equal((await call(client, "exportMarkdown", { ride: "1", file: join(dir, "r2.md") })).markdown, null);
    const gpx = await call(client, "exportGpx", { roadbookId: 1, file: join(dir, "r.gpx") });
    assert.equal(gpx.pushed, false);

    const note = await call(client, "addRideNote", { text: "cobbles, never again", rating: 1 });
    assert.equal(note.roadbookId, 1);
    const review = await call(client, "reviewRide", { ride: "1" });
    assert.equal(review.status, "review");
    assert.equal(review.notes.length, 2);
    const applied = await call(client, "reviewRide", {
      decisions: [{ noteId: review.notes[0].noteId, rating: 4 }],
    });
    assert.equal(applied.status, "applied");

    await call(client, "rateRide", { ride: "1", rating: 3, day: today });
    await call(client, "rateRide", { ride: "1", rating: 4, leg: 1 });
    assert.equal((await call(client, "rateRide", { ride: "1", rating: 0 })).status, "scope_needed");
    assert.equal((await call(client, "rateRide", { ride: "1", rating: 5 })).status, "rated");
    const stretch = await call(client, "rateStretch", { from: "Lille", to: "Cassel", rating: 5 });
    const rated = await call(client, "listRatedRoads");
    assert.equal(rated.roadbooks[0].id, 1);
    assert.equal(rated.legs.length, 1);
    assert.ok(rated.stretches.some((s: { id: number }) => s.id === stretch.stretchId));
    assert.equal((await call(client, "deleteStretchRating", { id: stretch.stretchId })).status, "confirmation_needed");
    assert.equal(
      (await call(client, "deleteStretchRating", { id: stretch.stretchId, confirm: true })).status,
      "deleted",
    );

    const briefing = await call(client, "rideBriefing", { ride: "1" });
    assert.equal(briefing.roadbookId, 1);
    const planned = await call(client, "planRide", { roadbook: "1", date: "tomorrow", departure: "10:00" });
    assert.equal(planned.departure, "10:00");
    const refreshed = await call(client, "refreshRide", { ride: "1" });
    assert.equal(refreshed.stopsOnly, false);
    await call(client, "reportScout", { area: "Flandre", location: "Cassel", found: false, verdict: "Too straight." });
  } finally {
    await client.close();
  }
});

test("outputSchemas: routing, saving, versions, copies and deletions return matching structured results", async () => {
  const { db } = library();
  const client = await connect(db);
  try {
    await call(client, "rideSettings", { home: "Lille" });
    await call(client, "planRide", { roadbook: "1", date: "tomorrow", departure: "08:00" });
    // Open roadbook 1 for a change, then save a routed loop over it: a change in place, one version kept.
    await call(client, "planningGuide", { request: "change it", ride: "1" });
    const trip = await call(client, "calculateTrip", {
      waypoints: ["Lille", "Cassel", "Mont des Cats"],
      roundTrip: true,
    });
    const checked = await call(client, "checkItinerary", {
      routeId: trip.routeId,
      request: "a short ride",
      itinerary: "Lille, Cassel and back",
    });
    assert.equal(typeof checked.passed, "boolean");
    assert.ok(Array.isArray(checked.violations));
    const saved = await call(client, "saveRide", {
      routeId: trip.routeId,
      name: "Flandre",
      rideDate: null,
      departure: null,
      itinerary: "loop",
      request: "loop",
    });
    assert.equal(saved.status, "changed");
    assert.equal(saved.roadbookId, 1);
    const restored = await call(client, "restoreRoadbook", { roadbook: "1", version: 1 });
    assert.equal(restored.roadbookId, 1);

    const copy = await call(client, "copyRoadbook", { roadbook: "1", name: "Variant" });
    assert.equal(copy.sourceId, 1);
    await call(client, "planRide", { roadbook: String(copy.roadbookId), date: "tomorrow", departure: "09:00" });
    await call(client, "keepRideVersion", { roadbook: "1", date: "tomorrow" });
    const cancelled = await call(client, "cancelRide", { roadbook: String(copy.roadbookId), date: "tomorrow" });
    assert.equal(cancelled.cancelled, true);
    assert.equal(
      (await call(client, "deleteRide", { roadbook: String(copy.roadbookId), date: "tomorrow" })).status,
      "confirmation_needed",
    );
    assert.equal(
      (await call(client, "deleteRide", { roadbook: String(copy.roadbookId), date: "tomorrow", confirm: true })).status,
      "deleted",
    );
    assert.equal(
      (await call(client, "deleteRoadbook", { roadbook: String(copy.roadbookId), confirm: true })).status,
      "deleted",
    );
  } finally {
    await client.close();
  }
});

test("outputSchemas: refused saves and closed dialogs still match their schema", async () => {
  const { db } = library();
  const loop = { waypoints: ["Lille", "Cassel", "Mont des Cats"], roundTrip: true };
  const save = (routeId: string) => ({
    routeId,
    name: "Flandre",
    rideDate: null,
    departure: null,
    itinerary: "135 km",
    request: "loop",
  });
  const first = await connect(db);
  try {
    await call(first, "rideSettings", { home: "Lille" });
    const trip = await call(first, "calculateTrip", loop);
    assert.equal((await call(first, "saveRide", save(trip.routeId))).status, "saved");
  } finally {
    await first.close();
  }
  // A client without forms: the repeat is refused in the result; with forms, a "no" is refused too.
  const plain = await connect(db);
  try {
    await call(plain, "rideSettings", { home: "Lille" });
    const trip = await call(plain, "calculateTrip", loop);
    const refused = await call(plain, "saveRide", save(trip.routeId));
    assert.equal(refused.status, "not_saved");
    assert.equal(refused.roadbookId, null);
  } finally {
    await plain.close();
  }
  const forms = await connect(db, true);
  forms.setRequestHandler(ElicitRequestSchema, async () => ({ action: "cancel" }));
  try {
    await call(forms, "rideSettings", { home: "Lille" });
    const trip = await call(forms, "calculateTrip", loop);
    assert.equal((await call(forms, "saveRide", save(trip.routeId))).status, "not_saved");
    assert.equal((await call(forms, "reviewRide", { ride: "1" })).status, "form_closed");
    assert.equal((await call(forms, "rateRide", { ride: "1", rating: 0 })).status, "cancelled");
    assert.equal((await call(forms, "deleteRoadbook", { roadbook: "1" })).status, "not_deleted");
  } finally {
    await forms.close();
  }
});

/** A GPX as the phone writes it, riding the roadbook of `library()` (the header names it). */
function recordedGpx(): string {
  const pts = Array.from({ length: 30 }, (_, i) => {
    const time = new Date(Date.UTC(2026, 9, 31, 9, 0, i)).toISOString();
    return `<trkpt lat="${(50.4 + i * 0.0002).toFixed(6)}" lon="3.000000"><time>${time}</time><extensions><motoride:speed>17.4</motoride:speed></extensions></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0"?><gpx version="1.1" creator="MotoRide" xmlns="http://www.topografix.com/GPX/1/1" xmlns:motoride="https://example.org/m"><metadata><name>Straight north, 2026-10-31</name><extensions><motoride:ride roadbook="1" name="Straight north" source="MotoRide" sourceRoadbook="1" sourceName="Straight north" state="completed"/></extensions></metadata><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

test("outputSchemas: a recorded ride is listed and reviewed against its roadbook, then decisions are answered", async () => {
  const { db } = library();
  const store = new Store(db);
  keepRide(store, "2026-10-31T09-00-00-straight-north", recordedGpx());
  store.close();
  const client = await connect(db);
  try {
    await call(client, "rideSettings", { home: "Lille" });
    const listed = await call(client, "listRecordedRides");
    assert.equal(listed.rides.length, 1);
    assert.equal(listed.rides[0].id, "2026-10-31T09-00-00-straight-north");
    assert.deepEqual(listed.rides[0].roadbook, { id: 1, name: "Straight north" });

    const review = await call(client, "reviewRecordedRide");
    assert.equal(review.status, "review");
    assert.equal(review.ride.id, "2026-10-31T09-00-00-straight-north");
    assert.deepEqual(review.roadbook, { id: 1, name: "Straight north" });
    assert.ok(Array.isArray(review.proposals));

    // A decision on a proposal that does not exist is answered, not an error.
    const applied = await call(client, "reviewRecordedRide", { decisions: [{ n: 9, action: "reject" }] });
    assert.equal(applied.status, "applied");
    assert.deepEqual(applied.results, ["No proposal 9."]);
  } finally {
    await client.close();
  }
});
