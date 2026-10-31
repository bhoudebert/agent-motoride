import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { PUBLIC_VALHALLA, resetValhallaRanking, valhallaJson, valhallaUrls } from "../src/http.ts";

const A = "http://valhalla:8002";
const B = "http://valhalla2:8002";

/** Sets VALHALLA_URL for one test and forgets what was known of the servers. */
function withUrls(t: TestContext, value: string | undefined) {
  const before = process.env.VALHALLA_URL;
  if (value === undefined) delete process.env.VALHALLA_URL;
  else process.env.VALHALLA_URL = value;
  resetValhallaRanking();
  t.after(() => {
    if (before === undefined) delete process.env.VALHALLA_URL;
    else process.env.VALHALLA_URL = before;
    resetValhallaRanking();
  });
}

type Server = { built?: number; down?: boolean; status?: number };
/** A fetch that plays the servers by host and writes down every URL asked. */
function servers(t: TestContext, byHost: Record<string, Server>): string[] {
  const asked: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const u = new URL(String(url));
    asked.push(String(url));
    const s = byHost[u.host]!;
    if (s.down) throw new TypeError("fetch failed");
    if (u.pathname === "/status")
      return new Response(JSON.stringify(s.built === undefined ? {} : { tileset_last_modified: s.built }));
    if (s.status) return new Response("no", { status: s.status });
    return new Response(JSON.stringify({ from: u.host }));
  });
  return asked;
}

test("VALHALLA_URL can list several servers, separated by commas, each checked", (t) => {
  withUrls(t, " http://valhalla:8002/ , http://valhalla2:8002 ,");
  assert.deepEqual(valhallaUrls(), [A, B]);
  withUrls(t, undefined);
  assert.deepEqual(valhallaUrls(), [PUBLIC_VALHALLA]);
  withUrls(t, "http://valhalla:8002,not a url");
  assert.throws(() => valhallaUrls(), /VALHALLA_URL is not a URL: not a url \(in http/);
  withUrls(t, "http://valhalla:8002,ftp://x/");
  assert.throws(() => valhallaUrls(), /must be http or https/);
});

test("with one server a request goes there and /status is never asked", async (t) => {
  withUrls(t, A);
  const asked = servers(t, { "valhalla:8002": {} });
  assert.deepEqual(await valhallaJson("/route"), { from: "valhalla:8002" });
  assert.deepEqual(asked, [`${A}/route`]);
});

test("with several servers the one whose map is newest answers, and the ranking is kept", async (t) => {
  withUrls(t, `${A},${B}`);
  const asked = servers(t, { "valhalla:8002": { built: 1000 }, "valhalla2:8002": { built: 2000 } });
  assert.deepEqual(await valhallaJson("/route"), { from: "valhalla2:8002" });
  assert.deepEqual(await valhallaJson("/route"), { from: "valhalla2:8002" });
  assert.equal(asked.filter((u) => u.endsWith("/status")).length, 2, "each server asked once, not once per request");
});

test("a server that does not answer or does not say its date comes after those that do", async (t) => {
  withUrls(t, `${A},${B}`);
  servers(t, { "valhalla:8002": { down: true }, "valhalla2:8002": { built: 5 } });
  assert.deepEqual(await valhallaJson("/route"), { from: "valhalla2:8002" });
  withUrls(t, `${A},${B}`);
  servers(t, { "valhalla:8002": {}, "valhalla2:8002": { built: 5 } });
  assert.deepEqual(await valhallaJson("/route"), { from: "valhalla2:8002" });
  withUrls(t, `${A},${B}`);
  servers(t, { "valhalla:8002": {}, "valhalla2:8002": {} });
  assert.deepEqual(await valhallaJson("/route"), { from: "valhalla:8002" }, "equal servers keep the order given");
});

test("when the newest server fails the next one answers, and the ranking is asked again", async (t) => {
  withUrls(t, `${A},${B}`);
  const asked = servers(t, { "valhalla:8002": { built: 1 }, "valhalla2:8002": { built: 2, status: 503 } });
  assert.deepEqual(await valhallaJson("/route"), { from: "valhalla:8002" });
  await valhallaJson("/route");
  assert.equal(asked.filter((u) => u.endsWith("/status")).length, 4, "asked again after the failure");
});

test("a request that is wrong is not tried on another server, a busy server is", async (t) => {
  withUrls(t, `${A},${B}`);
  const asked = servers(t, { "valhalla:8002": { built: 1 }, "valhalla2:8002": { built: 2, status: 400 } });
  await assert.rejects(() => valhallaJson("/route"), /responded 400/);
  assert.equal(asked.filter((u) => u.endsWith("/route")).length, 1);
  withUrls(t, `${A},${B}`);
  servers(t, { "valhalla:8002": { built: 1 }, "valhalla2:8002": { built: 2, status: 429 } });
  assert.deepEqual(await valhallaJson("/route"), { from: "valhalla:8002" });
});

test("when every server fails the error says so and keeps the cause", async (t) => {
  withUrls(t, `${A},${B}`);
  servers(t, { "valhalla:8002": { built: 1, status: 502 }, "valhalla2:8002": { built: 2, status: 503 } });
  await assert.rejects(
    () => valhallaJson("/route"),
    (e: Error) => /No Valhalla server answered \(2 tried\)/.test(e.message) && e.cause instanceof Error,
  );
});
