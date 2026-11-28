import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { joinInFlight } from "../src/tools/along.ts";
import { overpass, overpassUrls, resetOverpass } from "../src/tools/roads.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  delete process.env.OVERPASS_URL;
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

test("OVERPASS_URL: addresses are checked, the query path is added, none means the public instances only", () => {
  assert.deepEqual(overpassUrls({}), []);
  assert.deepEqual(overpassUrls({ OVERPASS_URL: "  " }), []);
  assert.deepEqual(overpassUrls({ OVERPASS_URL: "http://overpass-be, http://overpass-fr:8080/api/interpreter" }), [
    "http://overpass-be/api/interpreter",
    "http://overpass-fr:8080/api/interpreter",
  ]);
  assert.throws(() => overpassUrls({ OVERPASS_URL: "overpass-be" }), /not a URL/);
  assert.throws(() => overpassUrls({ OVERPASS_URL: "ftp://overpass-be" }), /must be http or https/);
});

test("own instances are asked first, each knows its region, and their answers are merged by id", async () => {
  process.env.OVERPASS_URL = "http://overpass-be,http://overpass-fr";
  const hosts = fakeFetch((host) =>
    host === "overpass-be"
      ? answer(200, {
          elements: [
            { type: "node", id: 1 },
            { type: "node", id: 2 },
          ],
        })
      : answer(200, {
          elements: [
            { type: "node", id: 2 },
            { type: "node", id: 3 },
          ],
        }),
  );
  const found = await overpass<{ type: string; id: number }>("q");
  assert.deepEqual(found.map((e) => e.id).sort(), [1, 2, 3], "an element on the border is kept once");
  assert.deepEqual(hosts.sort(), ["overpass-be", "overpass-fr"], "the public instances are not asked");
});

test("when one own instance does not answer, the public instances answer instead, and it is left alone for a while", async () => {
  process.env.OVERPASS_URL = "http://overpass-be,http://overpass-fr";
  const first = fakeFetch((host) =>
    host === "overpass-fr"
      ? answer(502, "starting")
      : host === "overpass-be"
        ? answer(200, { elements: [] })
        : answer(200, { elements: [{ type: "node", id: 9 }] }),
  );
  const found = await overpass<{ id: number }>("q", { quick: true });
  assert.deepEqual(
    found.map((e) => e.id),
    [9],
    "the answer is the public one, not the half of a region",
  );
  assert.ok(first.includes("overpass-fr") && first.includes("overpass-api.de"));
  const second = fakeFetch((host) => (host === "overpass-api.de" ? answer(200, { elements: [] }) : answer(500, "no")));
  await overpass("q", { quick: true });
  assert.deepEqual(
    second,
    ["overpass-api.de"],
    "the failed own instance is not asked again for a minute, nor the other one",
  );
});

test("a server remark from an own instance falls back for that query only", async () => {
  process.env.OVERPASS_URL = "http://overpass-be";
  fakeFetch((host) =>
    host === "overpass-be"
      ? answer(200, { elements: [], remark: "runtime error: timeout" })
      : answer(200, { elements: [{ type: "node", id: 5 }] }),
  );
  assert.equal((await overpass("q", { quick: true })).length, 1);
  const again = fakeFetch(() => answer(200, { elements: [] }));
  await overpass("q", { quick: true });
  assert.deepEqual(again, ["overpass-be"], "a heavy query does not put the instance to rest");
});

test("own instances and every public one failing: the failure names them all", async () => {
  process.env.OVERPASS_URL = "http://overpass-be";
  fakeFetch(() => answer(502, "down"));
  await assert.rejects(
    overpass("q", { quick: true }),
    /overpass-be: .*overpass-api\.de: .*overpass\.openstreetmap\.fr/,
  );
});

test("a query nobody gave a deadline to still ends within the default budget, not after every retry", async () => {
  resetOverpass({ budgetMs: 2_500 });
  const hosts = fakeFetch(() => new Promise<Response>(() => {}));
  const started = Date.now();
  await assert.rejects(overpass("q"), /time budget used/);
  assert.ok(Date.now() - started < 4_000, `took ${Date.now() - started} ms`);
  assert.equal(hosts.length, 1);
});

test("attempts that fail on their own count towards resting Overpass, even when the budget then ends the query", async () => {
  // Each attempt is answered in time with an error, then the budget (set low) ends the query: the failures are real.
  resetOverpass({ budgetMs: 2_200 });
  fakeFetch(() => answer(502, "at capacity"));
  await assert.rejects(overpass("q"), /unavailable right now/);
  await assert.rejects(overpass("q"), /unavailable right now/);
  const hosts = fakeFetch(() => answer(200, { elements: [] }));
  await assert.rejects(overpass("q"), /not asked again for \d+ s/);
  assert.equal(hosts.length, 0, "the third query sends nothing while Overpass rests");
});
