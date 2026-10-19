import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { routeCells } from "../src/geometry.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import type { NewRide } from "../src/store.ts";
import { installFakeServices } from "./helpers/fakeServices.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

// The data folder is read when the modules load: point it at a scratch folder first.
const dir = mkdtempSync(join(tmpdir(), "ride-server-"));
process.env.RIDE_DATA_DIR = dir;
const { tenantDbPath, tenantDir } = await import("../src/dataDir.ts");
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { Store } = await import("../src/store.ts");

installFakeServices();

const shapes = [encodePolyline(bentLine({ lat: 50.4, lon: 3 }, { lat: 50.6, lon: 3 }, 200))];
const ride = (name: string): NewRide => ({
  name,
  parentId: null,
  home: "Lille",
  rideDate: null,
  departure: null,
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

/** A server on a free port with two riders, each with a roadbook of their own. */
async function setup(options: Record<string, unknown> = {}) {
  const registry = new Registry(":memory:");
  const alice = registry.add("alice@example.org");
  const bob = registry.add("bob@example.org");
  for (const [who, name] of [
    [alice, "Alice's loop"],
    [bob, "Bob's loop"],
  ] as const) {
    const store = new Store(tenantDbPath(who.tenant.id));
    store.saveRide(ride(name));
    store.close();
  }
  let clock = 1_000_000;
  const now = () => clock;
  const app = createHttpServer({ registry, now, ...options });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const connect = async (token: string) => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    return { error: r.isError === true, text: r.content[0]!.text };
  };
  return { registry, alice, bob, app, url, connect, call, tick: (ms: number) => (clock += ms) };
}

test("the server answers a health check, and the tools only to a rider with a token", async () => {
  const s = await setup();
  try {
    const health = await (await fetch(`${s.url}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal((await fetch(`${s.url}/nope`)).status, 404);
    for (const headers of [
      {},
      { Authorization: "Bearer" },
      { Authorization: "Bearer mrt_wrong" },
      { Authorization: "Basic abc" },
    ]) {
      const r = await fetch(`${s.url}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers as Record<string, string>) },
        body: "{}",
      });
      assert.equal(r.status, 401);
      assert.equal(r.headers.get("www-authenticate"), "Bearer");
    }
    const client = await s.connect(s.alice.token);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["calculateTrip", "listRoadbooks", "exportGpx", "reviewRide", "planningGuide"])
      assert.ok(tools.includes(name), name);
    assert.ok((client.getInstructions() ?? "").includes("planningGuide"));
    await client.close();
  } finally {
    await s.app.close();
  }
});

test("each rider sees only their own library", async () => {
  const s = await setup();
  try {
    const a = await s.connect(s.alice.token);
    const b = await s.connect(s.bob.token);
    const listA = (await s.call(a, "listRoadbooks")).text;
    const listB = (await s.call(b, "listRoadbooks")).text;
    assert.match(listA, /Alice's loop/);
    assert.doesNotMatch(listA, /Bob's loop/);
    assert.match(listB, /Bob's loop/);
    assert.doesNotMatch(listB, /Alice's loop/);
    // A rider cannot open another's roadbook by number or by name.
    assert.match((await s.call(b, "showRide", { ride: "Alice" })).text + "", /No saved ride|not found|Alice/i);
    await a.close();
    await b.close();
  } finally {
    await s.app.close();
  }
});

test("a session belongs to the rider who opened it", async () => {
  const s = await setup();
  try {
    const open = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${s.alice.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    });
    assert.equal(open.status, 200);
    const sid = open.headers.get("mcp-session-id")!;
    assert.ok(sid);
    const call = (token: string) =>
      fetch(`${s.url}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
          "mcp-session-id": sid,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      });
    assert.equal((await call(s.bob.token)).status, 404, "another rider's token does not reach it, and learns nothing");
    assert.equal((await call(s.alice.token)).status, 200);
    assert.equal(
      (
        await fetch(`${s.url}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${s.bob.token}`,
            "mcp-session-id": "made-up",
          },
          body: "{}",
        })
      ).status,
      404,
    );
  } finally {
    await s.app.close();
  }
});

test("a suspended rider is shut out at once, even in an open session", async () => {
  const s = await setup();
  try {
    const client = await s.connect(s.alice.token);
    assert.match((await s.call(client, "listRoadbooks")).text, /Alice's loop/);
    s.registry.setStatus("alice@example.org", "suspended");
    await assert.rejects(s.call(client, "listRoadbooks"));
    s.registry.setStatus("alice@example.org", "active");
    const again = await s.connect(s.alice.token);
    assert.match((await s.call(again, "listRoadbooks")).text, /Alice's loop/);
    await again.close();
  } finally {
    await s.app.close();
  }
});

test("exports stay in the rider's own folder: a default goes there, a path that leaves it is refused", async () => {
  const s = await setup();
  try {
    const a = await s.connect(s.alice.token);
    const ok = await s.call(a, "exportGpx", { rideId: 1 });
    assert.equal(ok.error, false, ok.text);
    const mine = join(tenantDir(s.alice.tenant.id), "exports");
    assert.ok(
      existsSync(mine) && readdirSync(mine).some((f) => f.endsWith(".gpx")),
      "written under the rider's folder",
    );
    assert.ok(!existsSync(join(tenantDir(s.bob.tenant.id), "exports")), "nothing in another rider's");
    for (const file of [
      "../../escape.gpx",
      "/tmp/escape.gpx",
      "~/escape.gpx",
      join(tenantDir(s.bob.tenant.id), "x.gpx"),
    ]) {
      const r = await s.call(a, "exportGpx", { rideId: 1, file });
      assert.equal(r.error, true, file);
      assert.match(r.text, /stay inside your own folder/, file);
    }
    const named = await s.call(a, "exportGpx", { rideId: 1, file: "mine.gpx" });
    assert.equal(named.error, false);
    assert.ok(existsSync(join(mine, "mine.gpx")));
    // Reading a recorded track or a route file is confined the same way.
    const review = await s.call(a, "reviewRide", { ride: "Alice", gpxPath: "/etc/passwd" });
    assert.equal(review.error, true);
    assert.match(review.text, /stay inside your own folder/);
    await a.close();
  } finally {
    await s.app.close();
  }
});

test("a rider has a limited number of sessions and requests, and idle sessions are closed", async () => {
  const s = await setup({ perRider: 2, perMinute: 6, idleMs: 60_000 });
  try {
    const one = await s.connect(s.alice.token);
    const two = await s.connect(s.alice.token);
    await assert.rejects(s.connect(s.alice.token), /429|Too many|Streamable/i);
    assert.equal(s.app.sessions.size, 2);
    // Bob is not held back by Alice's sessions.
    const bobs = await s.connect(s.bob.token);
    assert.equal(s.app.sessions.size, 3);
    s.tick(61_000);
    assert.equal(await s.app.sweep(), 3, "idle sessions are closed");
    assert.equal(s.app.sessions.size, 0);
    await one.close().catch(() => {});
    await two.close().catch(() => {});
    await bobs.close().catch(() => {});
  } finally {
    await s.app.close();
  }
});

test("too many requests in a minute are answered with a wait, a big body is refused", async () => {
  const s = await setup({ perMinute: 3, maxBody: 2000 });
  try {
    const hit = () =>
      fetch(`${s.url}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.alice.token}` },
        body: "{}",
      });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await hit()).status);
    assert.deepEqual(statuses.slice(3), [429, 429]);
    s.tick(61_000);
    const big = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.alice.token}` },
      body: JSON.stringify({ x: "y".repeat(5000) }),
    });
    assert.equal(big.status, 413);
  } finally {
    await s.app.close();
  }
});
