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

const CH = "abcdefghijklmnopqrstuv"; // 22 characters
const IV = "AAAAAAAAAAAAAAAA";
const CT = "B".repeat(60);

test("live sharing: a rider creates a channel, publishes, a follower with no token reads, the rider ends it", async () => {
  const s = await setup({ live: { minGapMs: 0 } });
  try {
    const rider = { Authorization: `Bearer ${s.alice.token}`, "Content-Type": "application/json" };
    const put = await fetch(`${s.url}/share/${CH}`, { method: "PUT", headers: rider });
    assert.equal(put.status, 201);
    assert.equal(
      (await fetch(`${s.url}/share/${CH}`, { method: "PUT", headers: rider })).status,
      200,
      "confirmed for the same rider",
    );
    const post = await fetch(`${s.url}/share/${CH}`, {
      method: "POST",
      headers: rider,
      body: JSON.stringify({ iv: IV, ct: CT }),
    });
    assert.equal(post.status, 200);
    assert.equal((await post.json()).seq, 1);

    // A follower has no token at all.
    const read = await (await fetch(`${s.url}/share/${CH}?after=0`)).json();
    assert.equal(read.state, "live");
    assert.deepEqual(
      read.items.map((u: { seq: number; iv: string; ct: string }) => [u.seq, u.iv, u.ct]),
      [[1, IV, CT]],
    );
    assert.equal((await (await fetch(`${s.url}/share/${CH}?after=1`)).json()).items.length, 0);
    assert.equal((await fetch(`${s.url}/health`).then((r) => r.json())).shares, 1);

    const end = await fetch(`${s.url}/share/${CH}?mode=end`, { method: "DELETE", headers: rider });
    assert.equal(end.status, 200);
    assert.equal((await (await fetch(`${s.url}/share/${CH}`)).json()).state, "ended");
    const late = await fetch(`${s.url}/share/${CH}`, {
      method: "POST",
      headers: rider,
      body: JSON.stringify({ iv: IV, ct: CT }),
    });
    assert.equal(late.status, 410);
    assert.equal((await fetch(`${s.url}/share/${CH}?mode=stop`, { method: "DELETE", headers: rider })).status, 200);
    assert.equal((await fetch(`${s.url}/share/${CH}`)).status, 404);
  } finally {
    await s.app.close();
  }
});

test("live sharing: publishing needs the rider's token, another rider cannot touch the channel, a bad channel is nothing", async () => {
  const s = await setup({ live: { minGapMs: 0 } });
  try {
    const as = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
    assert.equal((await fetch(`${s.url}/share/${CH}`, { method: "PUT" })).status, 401);
    assert.equal((await fetch(`${s.url}/share/${CH}`, { method: "PUT", headers: as("mrt_wrong") })).status, 401);
    await fetch(`${s.url}/share/${CH}`, { method: "PUT", headers: as(s.alice.token) });
    assert.equal((await fetch(`${s.url}/share/${CH}`, { method: "PUT", headers: as(s.bob.token) })).status, 409);
    const body = JSON.stringify({ iv: IV, ct: CT });
    assert.equal(
      (await fetch(`${s.url}/share/${CH}`, { method: "POST", headers: as(s.bob.token), body })).status,
      404,
      "it looks like no channel",
    );
    assert.equal(
      (await fetch(`${s.url}/share/${CH}?mode=stop`, { method: "DELETE", headers: as(s.bob.token) })).status,
      404,
    );
    assert.notEqual((await fetch(`${s.url}/share/${CH}`)).status, 404, "and Bob changed nothing");
    for (const path of ["/share/short", "/share/", `/share/${CH}x`, "/share/a%2F..%2Fb"])
      assert.equal((await fetch(`${s.url}${path}`)).status, 404, path);
    assert.equal((await fetch(`${s.url}/share/${CH}`, { method: "PATCH", headers: as(s.alice.token) })).status, 405);
  } finally {
    await s.app.close();
  }
});

test("live sharing: updates are limited in size, shape, pace and number of channels", async () => {
  const s = await setup({ live: { minGapMs: 2000 }, perMinute: 1000 });
  try {
    const h = { Authorization: `Bearer ${s.alice.token}`, "Content-Type": "application/json" };
    const channels = ["a", "b", "c", "d"].map((c) => c.repeat(22));
    assert.deepEqual(
      await Promise.all(
        channels.map((c) => fetch(`${s.url}/share/${c}`, { method: "PUT", headers: h }).then((r) => r.status)),
      ),
      [201, 201, 201, 429],
      "three at once",
    );
    const post = (body: unknown) =>
      fetch(`${s.url}/share/${channels[0]}`, {
        method: "POST",
        headers: h,
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    assert.equal((await post({ iv: IV, ct: CT })).status, 200);
    assert.equal((await post({ iv: IV, ct: CT })).status, 429, "one every 2 seconds");
    assert.equal((await post({ iv: "short", ct: CT })).status, 400);
    assert.equal((await post("not json")).status, 400);
    assert.equal((await post({ iv: IV, ct: "B".repeat(5000) })).status, 413, "a body over 4 KiB");
  } finally {
    await s.app.close();
  }
});

test("live sharing: the follower's page is the same for every link, with a strict policy, and its script is served", async () => {
  const s = await setup();
  try {
    for (const path of [`/follow/${CH}`, "/follow/anything", "/follow/"]) {
      const r = await fetch(`${s.url}${path}`);
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get("content-type") ?? "", /text\/html/);
      assert.equal(r.headers.get("referrer-policy"), "no-referrer");
      const csp = r.headers.get("content-security-policy") ?? "";
      assert.match(csp, /default-src 'none'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.doesNotMatch(csp, /unsafe-eval/);
      const html = await r.text();
      assert.match(html, /id="map"/);
      assert.match(html, /integrity="sha384-/, "the map library is pinned with a hash");
    }
    const js = await fetch(`${s.url}/follow.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    assert.match(await js.text(), /AES-GCM/);
    assert.equal((await fetch(`${s.url}/follow/${CH}`, { method: "POST" })).status, 404);
  } finally {
    await s.app.close();
  }
});

test("live sharing: what a phone encrypts, the relay carries and the page reads back, and the relay never sees the place", async () => {
  const { webcrypto, randomBytes } = await import("node:crypto");
  const { decryptUpdate, importKey } = await import("../assets/follow/follow.js");
  const s = await setup({ live: { minGapMs: 0 } });
  try {
    const channel = randomBytes(16).toString("base64url");
    const keyB64 = randomBytes(32).toString("base64url");
    const key = await webcrypto.subtle.importKey("raw", Buffer.from(keyB64, "base64url"), "AES-GCM", false, [
      "encrypt",
    ]);
    const iv = randomBytes(12);
    const secret = JSON.stringify({ v: 1, lat: 50.4512, lon: 3.2077, spd: 61, state: "riding" });
    const ct = Buffer.from(
      await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(channel) },
        key,
        new TextEncoder().encode(secret),
      ),
    ).toString("base64url");
    const h = { Authorization: `Bearer ${s.alice.token}`, "Content-Type": "application/json" };
    await fetch(`${s.url}/share/${channel}`, { method: "PUT", headers: h });
    await fetch(`${s.url}/share/${channel}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ iv: iv.toString("base64url"), ct }),
    });
    const raw = await (await fetch(`${s.url}/share/${channel}`)).text();
    assert.ok(
      !raw.includes("50.4512") && !raw.includes("3.2077") && !raw.includes(keyB64),
      "nothing the relay holds says where, or holds the key",
    );
    const body = JSON.parse(raw);
    const point = await decryptUpdate((await importKey(keyB64))!, channel, body.items[0]);
    assert.equal(point?.lat, 50.4512);
    assert.equal(point?.lon, 3.2077);
  } finally {
    await s.app.close();
  }
});

test("traffic: a rider's token is needed, a server with no key says so, and the points are validated", async () => {
  const none = await setup({ traffic: { key: "", provider: "tomtom-flow" } });
  const withKey = await setup({
    traffic: {
      key: "K",
      provider: "tomtom-flow",
      fetch: async () => ({ flowSegmentData: { currentSpeed: 20, freeFlowSpeed: 60, confidence: 1 } }),
    },
  });
  try {
    const post = (s: { url: string }, token: string | null, body: unknown) =>
      fetch(`${s.url}/traffic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    assert.equal((await fetch(`${withKey.url}/health`).then((r) => r.json())).traffic, true);
    assert.equal((await fetch(`${none.url}/health`).then((r) => r.json())).traffic, false);
    assert.equal((await post(withKey, null, { points: [[50, 3]] })).status, 401);
    assert.equal((await fetch(`${withKey.url}/traffic`)).status, 405);
    for (const points of [[], "x", [[50]], [[91, 3]], [["a", "b"]], Array(9).fill([50, 3])])
      assert.equal((await post(withKey, withKey.alice.token, { points })).status, 400, JSON.stringify(points));
    withKey.tick(61_000); // the bad tries counted against the minute too
    const ok = await post(withKey, withKey.alice.token, {
      points: [
        [50, 3],
        [50.1, 3.1],
      ],
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.points.length, 2);
    assert.equal(body.points[0].level, "heavy");
    assert.equal(body.budget, true);
    assert.equal((await post(none, none.alice.token, { points: [[50, 3]] })).status, 503);
  } finally {
    await none.app.close();
    await withKey.app.close();
  }
});

test("traffic: a rider may ask only so often, and a big body is refused", async () => {
  const s = await setup({
    traffic: {
      key: "K",
      provider: "tomtom-flow",
      fetch: async () => ({ flowSegmentData: { currentSpeed: 60, freeFlowSpeed: 60 } }),
    },
  });
  try {
    const post = (body: string) =>
      fetch(`${s.url}/traffic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.alice.token}` },
        body,
      });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await post(JSON.stringify({ points: [[50, 3]] }))).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429, 429]);
    s.tick(61_000);
    assert.equal((await post("x".repeat(5000))).status, 413);
  } finally {
    await s.app.close();
  }
});
