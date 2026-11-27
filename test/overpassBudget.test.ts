import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { joinInFlight } from "../src/tools/along.ts";
import { overpass, resetOverpass } from "../src/tools/roads.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  resetOverpass();
});

const answer = (status: number, body: unknown = "") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

/** A fetch that records the hosts it was asked and answers with `reply(host)`. */
function fakeFetch(reply: (host: string) => Response | Promise<Response>) {
  const hosts: string[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const host = new URL(input instanceof Request ? input.url : String(input)).host;
    hosts.push(host);
    const answered = reply(host);
    const signal = init?.signal;
    if (!signal) return answered;
    // Like the real fetch, give up when the attempt's own timeout fires.
    return Promise.race([
      answered,
      new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    ]);
  }) as typeof fetch;
  return hosts;
}

test("a mirror that answers 403 is not asked again by this process", async () => {
  const first = fakeFetch((host) =>
    host === "overpass.openstreetmap.fr"
      ? answer(403, "only available to white-listed usages")
      : answer(502, "at capacity"),
  );
  await assert.rejects(overpass("q", { quick: true }), /overpass.openstreetmap.fr: .*403/);
  assert.deepEqual(first, ["overpass-api.de", "overpass.openstreetmap.fr"]);
  const later = fakeFetch(() => answer(502, "at capacity"));
  await assert.rejects(overpass("q", { quick: true }), /unavailable/);
  assert.deepEqual(later, ["overpass-api.de"], "the refusing mirror is skipped after its 403");
});

test("after two queries that no instance answered, Overpass is left alone and the third fails at once", async () => {
  const hosts = fakeFetch(() => answer(502, "at capacity"));
  await assert.rejects(overpass("q", { quick: true }), /unavailable right now/);
  await assert.rejects(overpass("q", { quick: true }), /unavailable right now/);
  const asked = hosts.length;
  const started = Date.now();
  await assert.rejects(overpass("q", { quick: true }), /not asked again for \d+ s/);
  assert.equal(hosts.length, asked, "no request is sent while the breaker holds");
  assert.ok(Date.now() - started < 500);
});

test("a query stops at its deadline instead of working through every retry", async () => {
  const hosts = fakeFetch(
    () => new Promise<Response>(() => {}), // never answers: only the attempt's own timeout ends it
  );
  const started = Date.now();
  await assert.rejects(overpass("q", { deadline: Date.now() + 2_500 }), /time budget used/);
  assert.ok(Date.now() - started < 4_000, `took ${Date.now() - started} ms`);
  assert.equal(hosts.length, 1, "one attempt, cut at the deadline; no further attempt starts");
});

test("a query cut short by its deadline does not trip the breaker", async () => {
  fakeFetch(() => new Promise<Response>(() => {}));
  await assert.rejects(overpass("q", { deadline: Date.now() + 2_100 }), /time budget used/);
  await assert.rejects(overpass("q", { deadline: Date.now() + 2_100 }), /time budget used/);
  const hosts = fakeFetch(() => answer(200, { elements: [] }));
  assert.deepEqual(await overpass("q"), []);
  assert.equal(hosts.length, 1);
});

test("a lookup asked again while it runs joins the running one", async () => {
  let runs = 0;
  const slow = () =>
    new Promise<number>((resolve) => {
      runs++;
      setTimeout(() => resolve(runs), 30);
    });
  const [a, b] = await Promise.all([joinInFlight("k", slow), joinInFlight("k", slow)]);
  assert.equal(runs, 1);
  assert.equal(a, b);
  assert.equal(await joinInFlight("k", slow), 2, "once it is done, the next call runs again");
});
