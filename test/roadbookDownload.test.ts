import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The data folder is read when the modules load: point it at a scratch folder first.
process.env.RIDE_DATA_DIR = mkdtempSync(join(tmpdir(), "ride-roadbooks-"));
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { tenantDbPath } = await import("../src/dataDir.ts");
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
  const app = createHttpServer({
    registry,
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
  return { registry, alice, bob, first, app, url, get, made, failNext: () => (failNext = true) };
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

test("a roadbook file is made once per version, answers 304 to the stamp, and a failure is tried again", async () => {
  const s = await setup();
  try {
    const first = await s.get(`/roadbook/${s.first}`, s.alice.token);
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type") ?? "", /application\/json/);
    const etag = first.headers.get("etag")!;
    assert.equal(((await first.json()) as { format: string }).format, "motoride-roadbook");
    const list = (await (await s.get("/roadbooks", s.alice.token)).json()) as { roadbooks: Array<{ stamp: string }> };
    assert.equal(etag, `"${list.roadbooks[0]!.stamp}"`, "the list and the file speak of the same version");
    const again = await s.get(`/roadbook/${s.first}`, s.alice.token, { "If-None-Match": etag });
    assert.equal(again.status, 304);
    assert.deepEqual(s.made, ["Alice's loop"], "traced once, not for the second request");

    // The roadbook changes: another stamp, and the file is made again.
    const store = new Store(tenantDbPath(s.alice.tenant.id));
    store.setRouteLine(s.first, ["_p~iF~ps|U_ulLnnqCnnqC_ulL"], []);
    store.close();
    const next = await s.get(`/roadbook/${s.first}`, s.alice.token, { "If-None-Match": etag });
    assert.equal(next.status, 200);
    assert.notEqual(next.headers.get("etag"), etag);
    assert.equal(s.made.length, 2);

    s.failNext();
    const store2 = new Store(tenantDbPath(s.alice.tenant.id));
    store2.setRouteLine(s.first, ["_ulLnnqC_p~iF~ps|U"], []);
    store2.close();
    assert.equal((await s.get(`/roadbook/${s.first}`, s.alice.token)).status, 502);
    assert.equal((await s.get(`/roadbook/${s.first}`, s.alice.token)).status, 200, "a failure is not kept");
  } finally {
    await s.app.close();
    s.registry.close();
  }
});
