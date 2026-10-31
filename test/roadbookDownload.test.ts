import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The data folder is read when the modules load: point it at a scratch folder first.
process.env.RIDE_DATA_DIR = mkdtempSync(join(tmpdir(), "ride-roadbooks-"));
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { tenantDbPath, tenantDir } = await import("../src/dataDir.ts");
const { DEFAULT_PREFERENCES } = await import("../src/preferences.ts");
const { Store } = await import("../src/store.ts");
type NewRide = import("../src/store.ts").NewRide;

const ride = (name: string, shapes: string[] | null = ["_p~iF~ps|U_ulLnnqC"]): NewRide => ({
  name,
  parentId: null,
  home: "Lille",
  rideDate: null,
  departure: null,
  distanceKm: 120,
  ridingMinutes: 150,
  waypoints: ["Lille", "Cassel"],
  roundTrip: true,
  speedLimits: {},
  preferences: DEFAULT_PREFERENCES,
  request: "a loop",
  itinerary: "text",
  mapsUrl: "m",
  cells: [],
  shapes,
  centerLat: 50.7,
  centerLon: 2.8,
  usage: null,
  extras: null,
  legs: [],
});

async function setup() {
  const registry = new Registry(":memory:");
  const alice = registry.add("alice@example.org");
  const bob = registry.add("bob@example.org");
  const store = new Store(tenantDbPath(alice.tenant.id));
  const first = store.saveRide(ride("Alice's loop"));
  store.close();
  const bobStore = new Store(tenantDbPath(bob.tenant.id));
  bobStore.saveRide(ride("Bob's loop"));
  bobStore.close();
  const made: string[] = [];
  let failNext = false;
  let mapDay = "";
  const app = createHttpServer({
    registry,
    mapDay: async () => mapDay,
    makeRoadbookFile: async (_store, r) => {
      made.push(r.name);
      if (failNext) {
        failNext = false;
        throw new Error("Valhalla 429");
      }
      return JSON.stringify({ format: "motoride-roadbook", version: 1, name: r.name });
    },
  });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const get = (path: string, token?: string, headers: Record<string, string> = {}) =>
    fetch(`${url}${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
  return {
    registry,
    alice,
    bob,
    first,
    app,
    url,
    get,
    made,
    failNext: () => (failNext = true),
    setMapDay: (day: string) => (mapDay = day),
  };
}

test("the roadbook list and file need a rider's token and only show the rider's own roadbooks", async () => {
  const s = await setup();
  try {
    assert.equal((await s.get("/roadbooks")).status, 401);
    assert.equal((await s.get("/roadbooks", "mrt_wrong")).status, 401);
    assert.equal((await s.get(`/roadbook/${s.first}`)).status, 401);
    const list = (await (await s.get("/roadbooks", s.alice.token)).json()) as {
      roadbooks: Array<{ id: number; name: string; stamp: string; distanceKm: number }>;
    };
    assert.deepEqual(
      list.roadbooks.map((r) => r.name),
      ["Alice's loop"],
    );
    assert.match(list.roadbooks[0]!.stamp, /^[0-9a-f]{16}$/);
    const bobs = (await (await s.get("/roadbooks", s.bob.token)).json()) as { roadbooks: Array<{ name: string }> };
    assert.deepEqual(
      bobs.roadbooks.map((r) => r.name),
      ["Bob's loop"],
    );
    // Bob asks for Alice's roadbook number: he has a roadbook of that number of his own, so he gets his own, never hers.
    const crossed = await s.get(`/roadbook/${s.first}`, s.bob.token);
    assert.equal(((await crossed.json()) as { name: string }).name, "Bob's loop");
    assert.equal((await s.get("/roadbook/99", s.alice.token)).status, 404);
    assert.equal((await s.get("/roadbook/abc", s.alice.token)).status, 404);
    assert.equal((await s.get("/roadbooks", s.alice.token)).headers.get("etag"), null);
    const post = await fetch(`${s.url}/roadbooks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.alice.token}` },
    });
    assert.equal(post.status, 405);
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

type Listed = { id: number; stamp: string; state: string; mapDay?: string; error?: string };
const list = async (s: Awaited<ReturnType<typeof setup>>, token = s.alice.token) =>
  ((await (await s.get("/roadbooks", token)).json()) as { roadbooks: Listed[] }).roadbooks;
/** Polls the list until the first roadbook is in `state` (the refresh runs in the background). */
async function until(s: Awaited<ReturnType<typeof setup>>, state: string): Promise<Listed> {
  for (let i = 0; i < 100; i++) {
    const first = (await list(s))[0]!;
    if (first.state === state) return first;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the roadbook never became ${state}`);
}
const post = (s: Awaited<ReturnType<typeof setup>>, path: string, token = s.alice.token) =>
  fetch(`${s.url}${path}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
const edit = (s: Awaited<ReturnType<typeof setup>>, line: string[]) => {
  const store = new Store(tenantDbPath(s.alice.tenant.id));
  store.setRouteLine(s.first, line, []);
  store.close();
};

test("the first file of a roadbook is made on the first request, kept, and answered 304 to its stamp", async () => {
  const s = await setup();
  try {
    const before = (await list(s))[0]!;
    assert.equal(before.state, "outdated", "no file yet");
    const first = await s.get(`/roadbook/${s.first}`, s.alice.token);
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type") ?? "", /application\/json/);
    const etag = first.headers.get("etag")!;
    assert.equal(etag, `"${before.stamp}"`, "the list announced the stamp the file then has");
    assert.equal(((await first.json()) as { format: string }).format, "motoride-roadbook");
    const after = (await list(s))[0]!;
    assert.deepEqual([after.stamp, after.state], [before.stamp, "current"]);
    assert.equal((await s.get(`/roadbook/${s.first}`, s.alice.token, { "If-None-Match": etag })).status, 304);
    assert.deepEqual(s.made, ["Alice's loop"], "made once, not for the second request");
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

test("a changed roadbook is outdated but its ready file keeps being served until a refresh makes the new one", async () => {
  const s = await setup();
  try {
    const first = await s.get(`/roadbook/${s.first}`, s.alice.token);
    const etag = first.headers.get("etag")!;
    edit(s, ["_p~iF~ps|U_ulLnnqCnnqC_ulL"]);
    const outdated = (await list(s))[0]!;
    assert.deepEqual(
      [`"${outdated.stamp}"`, outdated.state],
      [etag, "outdated"],
      "the ready version is what is offered",
    );
    assert.equal(
      (await s.get(`/roadbook/${s.first}`, s.alice.token, { "If-None-Match": etag })).status,
      304,
      "no waiting, no new file yet",
    );
    assert.equal(s.made.length, 1);

    const answer = await post(s, `/roadbook/${s.first}/refresh`);
    assert.equal(answer.status, 202);
    assert.deepEqual(await answer.json(), { id: s.first, state: "refreshing" });
    const done = await until(s, "current");
    assert.notEqual(`"${done.stamp}"`, etag);
    assert.equal(s.made.length, 2);
    const fresh = await s.get(`/roadbook/${s.first}`, s.alice.token, { "If-None-Match": etag });
    assert.equal(fresh.status, 200, "a phone holding the old stamp is sent the new file");
    assert.equal(fresh.headers.get("etag"), `"${done.stamp}"`);
    assert.equal((await post(s, `/roadbook/${s.first}/refresh`)).status, 200, "already current: nothing to do");
    assert.equal(s.made.length, 2);
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

test("a refresh that fails says so, keeps serving the ready file and can be asked again", async () => {
  const s = await setup();
  try {
    const etag = (await s.get(`/roadbook/${s.first}`, s.alice.token)).headers.get("etag")!;
    edit(s, ["_ulLnnqC_p~iF~ps|U"]);
    s.failNext();
    await post(s, `/roadbook/${s.first}/refresh`);
    const failed = await until(s, "failed");
    assert.match(failed.error ?? "", /Valhalla 429/);
    assert.equal(`"${failed.stamp}"`, etag);
    assert.equal(
      (await s.get(`/roadbook/${s.first}`, s.alice.token)).headers.get("etag"),
      etag,
      "the ready file is served",
    );
    assert.equal((await post(s, `/roadbook/${s.first}/refresh`)).status, 202, "the rider's tap tries again");
    assert.equal((await until(s, "current")).state, "current");
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

test("a rebuilt Valhalla map makes the ready files outdated without changing their stamp until they are refreshed", async () => {
  const s = await setup();
  try {
    const { rideStamp } = await import("../src/roadbookDownload.ts");
    const reader = new Store(tenantDbPath(s.alice.tenant.id));
    const expected = rideStamp(reader.findRide("1")!);
    reader.close();
    const etag = (await s.get(`/roadbook/${s.first}`, s.alice.token)).headers.get("etag")!;
    assert.equal(etag, `"${expected}"`, "without a map day the stamp is what it was");

    s.setMapDay("2026-10-31");
    const outdated = (await list(s))[0]!;
    assert.deepEqual(
      [`"${outdated.stamp}"`, outdated.state],
      [etag, "outdated"],
      "nothing is offered before it is ready",
    );
    await post(s, `/roadbook/${s.first}/refresh`);
    const done = await until(s, "current");
    assert.notEqual(`"${done.stamp}"`, etag);
    assert.equal(done.mapDay, "2026-10-31");
    s.setMapDay("2026-11-14");
    assert.equal((await list(s))[0]!.state, "outdated", "each new map day outdates the file again");
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

test("the list refreshes by itself only a roadbook with a ride dated soon, and asking never waits", async () => {
  const s = await setup();
  try {
    const soon = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString().slice(0, 10);
    const store = new Store(tenantDbPath(s.alice.tenant.id));
    const dated = store.saveRide({ ...ride("Soon"), rideDate: soon, departure: "09:00" });
    store.close();
    await s.get(`/roadbook/${s.first}`, s.alice.token);
    await s.get(`/roadbook/${dated}`, s.alice.token);
    s.setMapDay("2026-10-31");
    const listed = await list(s);
    const byId = new Map(listed.map((r) => [r.id, r.state]));
    assert.equal(byId.get(s.first), "outdated", "no ride dated: it waits for the rider's tap");
    assert.equal(byId.get(dated), "refreshing", "a ride in three days: started by the list");
    for (let i = 0; i < 100 && (await list(s)).find((r) => r.id === dated)!.state !== "current"; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await list(s)).find((r) => r.id === dated)!.state, "current");
    assert.equal((await list(s)).find((r) => r.id === s.first)!.state, "outdated");
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

test("a refresh needs the rider's token, is a POST on a roadbook of the rider's own, and the other methods are refused", async () => {
  const s = await setup();
  try {
    assert.equal((await post(s, `/roadbook/${s.first}/refresh`, "")).status, 401);
    assert.equal((await post(s, `/roadbook/${s.first}/refresh`, "mrt_wrong")).status, 401);
    assert.equal((await post(s, "/roadbook/99/refresh")).status, 404);
    assert.equal((await s.get(`/roadbook/${s.first}/refresh`, s.alice.token)).status, 405);
    assert.equal((await post(s, `/roadbook/${s.first}`)).status, 405);
    assert.equal((await post(s, "/roadbooks")).status, 405);
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

test("ready files survive a restart and are forgotten with their roadbook", async () => {
  const s = await setup();
  try {
    const etag = (await s.get(`/roadbook/${s.first}`, s.alice.token)).headers.get("etag")!;
    const { ReadyRoadbooks } = await import("../src/roadbookDownload.ts");
    const restarted = new ReadyRoadbooks({ make: async () => assert.fail("nothing is made again") });
    const store = new Store(tenantDbPath(s.alice.tenant.id));
    const listed = await restarted.list(s.alice.tenant.id, store);
    assert.deepEqual([listed[0]!.state, `"${listed[0]!.stamp}"`], ["current", etag]);
    assert.equal((await restarted.get(s.alice.tenant.id, store, s.first))!.stamp, etag.slice(1, -1));
    assert.ok(store.deleteRide(s.first));
    assert.deepEqual(await restarted.list(s.alice.tenant.id, store), []);
    assert.equal(existsSync(join(tenantDir(s.alice.tenant.id), "roadbooks-ready", `${s.first}.json`)), false);
    store.close();
  } finally {
    await s.app.close();
    s.registry.close();
  }
});
