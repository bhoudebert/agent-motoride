import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The data folder is read when the modules load: point it at a scratch folder first.
process.env.RIDE_DATA_DIR = mkdtempSync(join(tmpdir(), "ride-push-"));
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { importRoadbookFile, importLegacyPushed, PushRefused } = await import("../src/importRoadbook.ts");
const { Store } = await import("../src/store.ts");
const { tenantDbPath, tenantDir } = await import("../src/dataDir.ts");
const { remoteConfig, pushRoadbookFile, pushExported } = await import("../src/remote.ts");
const { encodePolyline, bentLine } = await import("./helpers/polyline.ts");

const points = bentLine({ lat: 50.4, lon: 3.0 }, { lat: 50.5, lon: 3.2 }, 41, 0.01);
const line = encodePolyline(points);
const at = (i: number) => ({ lat: points[i]!.lat, lon: points[i]!.lon });
const file = (extra: Record<string, unknown> = {}) => ({
  format: "motoride-roadbook",
  version: 1,
  name: "Device loop",
  description: "122.3 km, about 2h05 riding.",
  generatedAt: "2026-10-30T10:00:00.000Z",
  line,
  stops: [
    { ...at(0), name: "Start", kind: "waypoint" },
    { ...at(10), name: "Café", kind: "stop" },
    { ...at(20), name: "Middle", kind: "waypoint" },
    { ...at(40), name: "End", kind: "waypoint" },
  ],
  limits: [
    { from: 0, to: 20, kmh: 50, posted: true, road: "D 1" },
    { from: 20, to: 40, kmh: 80, posted: false, road: "N 2" },
  ],
  cameras: [{ ...at(15), kmh: 70, bearing: 270, direction: null }],
  junctions: [],
  countries: [],
  origin: { app: "agentRide", roadbook: 7, name: "Device loop" },
  ...extra,
});
const library = () => new Store(join(mkdtempSync(join(tmpdir(), "ride-lib-")), "rides.db"));

test("a pushed roadbook file becomes a roadbook of the library: legs, waypoints, cameras, figures", () => {
  const store = library();
  const { id, replaced } = importRoadbookFile(store, file());
  assert.equal(replaced, false);
  const ride = store.findRide(String(id))!;
  assert.equal(ride.name, "Device loop");
  assert.deepEqual(ride.waypoints, ["Start", "Middle", "End"], "the planned stop is not a waypoint");
  assert.equal(ride.shapes!.length, 2, "one leg per pair of waypoints");
  assert.deepEqual(
    ride.legs.map((l) => [l.from, l.to]),
    [
      ["Start", "Middle"],
      ["Middle", "End"],
    ],
  );
  assert.deepEqual(ride.legs[0]!.mainRoads, ["D 1"]);
  assert.equal(ride.ridingMinutes, 125, "the time the file says");
  assert.ok(ride.distanceKm > 10 && ride.distanceKm < 40, String(ride.distanceKm));
  assert.equal(ride.roundTrip, false);
  assert.equal(ride.home, "Start");
  assert.equal(ride.extras!.cameras.length, 1);
  assert.deepEqual(
    [ride.extras!.cameras[0]!.limitKmh, ride.extras!.cameras[0]!.direction, ride.extras!.cameras[0]!.leg],
    [70, "270", 1],
  );
  assert.deepEqual(
    store.listRides().map((r) => r.id),
    [id],
  );
  store.close();
});

test("a roadbook with no waypoints is one leg between the ends of its line, and a loop is a round trip", () => {
  const store = library();
  const { id } = importRoadbookFile(store, file({ stops: [], origin: undefined, name: "Plain" }));
  const ride = store.findRide(String(id))!;
  assert.equal(ride.shapes!.length, 1);
  assert.equal(ride.shapes![0], line, "the line is kept as sent");
  assert.equal(ride.legs.length, 1);
  const loop = [...points.slice(0, 20), points[0]!];
  const closed = importRoadbookFile(
    store,
    file({ line: encodePolyline(loop), stops: [], origin: undefined, name: "Loop" }),
  );
  assert.equal(store.findRide(String(closed.id))!.roundTrip, true);
  store.close();
});

test("pushing the same roadbook again replaces it, keeping the earlier version; unchanged, it changes nothing", () => {
  const store = library();
  const first = importRoadbookFile(store, file());
  const again = importRoadbookFile(store, file({ generatedAt: "2026-10-31T10:00:00.000Z" }));
  assert.deepEqual(again, { id: first.id, replaced: true });
  assert.equal(store.listVersions(first.id).length, 0, "nothing changed: no new version");

  const changed = importRoadbookFile(store, file({ name: "Device loop", cameras: [] }));
  assert.deepEqual(changed, { id: first.id, replaced: true });
  assert.equal(store.listVersions(first.id).length, 1, "the earlier version is kept");
  assert.equal(store.findRide(String(first.id))!.extras!.cameras.length, 0);

  // Another roadbook of the library, and a file with no origin, are their own roadbooks.
  const other = importRoadbookFile(
    store,
    file({ origin: { app: "agentRide", roadbook: 8, name: "Other" }, name: "Other" }),
  );
  const plain = importRoadbookFile(store, file({ origin: undefined, name: "Plain" }));
  const samePlain = importRoadbookFile(store, file({ origin: undefined, name: "Plain" }));
  assert.equal(new Set([first.id, other.id, plain.id]).size, 3);
  assert.equal(samePlain.id, plain.id, "a file with no origin is told by its name");
  store.close();
});

test("what is not a roadbook file is refused", () => {
  const store = library();
  for (const bad of [
    null,
    [],
    "x",
    file({ format: "gpx" }),
    file({ version: 2 }),
    file({ name: "" }),
    file({ line: "" }),
  ])
    assert.throws(() => importRoadbookFile(store, bad), PushRefused);
  assert.deepEqual(store.listRides(), []);
  store.close();
});

async function setup() {
  const registry = new Registry(":memory:");
  const alice = registry.add("alice@example.org");
  const bob = registry.add("bob@example.org");
  const made: string[] = [];
  const app = createHttpServer({
    registry,
    makeRoadbookFile: async (_store, ride) => {
      made.push(ride.name);
      return JSON.stringify({ format: "motoride-roadbook", version: 1, name: ride.name });
    },
  });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const req = (method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  return { registry, alice, bob, app, url, req, made };
}

test("the server adds a pushed roadbook to its rider's library as their own, and lists and serves it like any other", async () => {
  const s = await setup();
  try {
    assert.equal((await s.req("PUT", "/roadbooks", undefined, file())).status, 401);
    assert.equal((await s.req("PUT", "/roadbooks", "mrt_wrong", file())).status, 401);
    assert.equal((await s.req("PUT", "/roadbooks", s.alice.token, "not json")).status, 400);
    assert.equal((await s.req("PUT", "/roadbooks", s.alice.token, file({ format: "gpx" }))).status, 400);
    assert.equal((await s.req("PUT", "/roadbook/5", s.alice.token, file())).status, 405);

    const put = await s.req("PUT", "/roadbooks", s.alice.token, file());
    assert.equal(put.status, 200);
    const kept = (await put.json()) as { id: number; stamp: string; replaced: boolean };
    assert.equal(kept.replaced, false);
    assert.equal(kept.id, 1, "an ordinary roadbook number");
    assert.match(kept.stamp, /^[0-9a-f]{16}$/);

    // It is a row of the rider's own library, and of nobody else's.
    const store = new Store(tenantDbPath(s.alice.tenant.id));
    assert.equal(store.findRide("1")!.name, "Device loop");
    store.close();
    const list = (await (await s.req("GET", "/roadbooks", s.alice.token)).json()) as {
      roadbooks: Array<{ id: number; name: string; stamp: string; state: string }>;
    };
    assert.deepEqual(
      list.roadbooks.map((r) => [r.id, r.name, r.stamp, r.state]),
      [[1, "Device loop", kept.stamp, "outdated"]],
    );
    const got = await s.req("GET", `/roadbook/1`, s.alice.token);
    assert.equal(got.headers.get("etag"), `"${kept.stamp}"`, "the list announced the version the file then has");
    assert.equal(((await got.json()) as { name: string }).name, "Device loop");
    assert.deepEqual(s.made, ["Device loop"], "made from the library on first request, like any roadbook");

    const bobs = (await (await s.req("GET", "/roadbooks", s.bob.token)).json()) as { roadbooks: unknown[] };
    assert.deepEqual(bobs.roadbooks, []);
    assert.equal((await s.req("GET", `/roadbook/1`, s.bob.token)).status, 404);

    const again = (await (await s.req("PUT", "/roadbooks", s.alice.token, file())).json()) as {
      id: number;
      stamp: string;
      replaced: boolean;
    };
    assert.deepEqual(
      [again.id, again.replaced, again.stamp],
      [1, true, kept.stamp],
      "unchanged: same roadbook, same version",
    );
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

test("roadbooks pushed when the server kept them as files are brought into the library once", async () => {
  const s = await setup();
  try {
    const dir = join(tenantDir(s.alice.tenant.id), "pushed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify({ next: 1000001, items: [{ id: 1000000 }, { id: 1000009 }] }),
    );
    writeFileSync(join(dir, "1000000.json"), JSON.stringify(file({ name: "Old push" })));
    const list = (await (await s.req("GET", "/roadbooks", s.alice.token)).json()) as {
      roadbooks: Array<{ id: number; name: string }>;
    };
    assert.deepEqual(
      list.roadbooks.map((r) => [r.id, r.name]),
      [[1, "Old push"]],
      "one file was missing and is skipped, the other is a roadbook now",
    );
    assert.equal(existsSync(dir), false);
    assert.ok(existsSync(`${dir}.imported`), "the folder is kept, renamed");
    const store = new Store(tenantDbPath(s.alice.tenant.id));
    assert.equal(importLegacyPushed(store, dir), 0, "nothing more to bring in");
    store.close();
  } finally {
    await s.app.close();
    s.registry.close();
  }
});

test("the client pushes with the rider's token and says what went wrong", async () => {
  assert.equal(remoteConfig({}), null);
  assert.throws(
    () => remoteConfig({ RIDE_REMOTE_URL: "https://x.example" }),
    /Both RIDE_REMOTE_URL and RIDE_REMOTE_TOKEN/,
  );
  assert.throws(() => remoteConfig({ RIDE_REMOTE_URL: "ftp://x", RIDE_REMOTE_TOKEN: "t" }), /must start with https/);
  assert.deepEqual(remoteConfig({ RIDE_REMOTE_URL: "https://x.example/", RIDE_REMOTE_TOKEN: "mrt_a" }), {
    url: "https://x.example",
    token: "mrt_a",
  });

  const s = await setup();
  try {
    const config = { url: s.url, token: s.alice.token };
    const kept = await pushRoadbookFile(JSON.stringify(file()), config);
    assert.equal(kept.replaced, false);
    assert.equal((await pushRoadbookFile(JSON.stringify(file()), config)).replaced, true);
    await assert.rejects(
      pushRoadbookFile(JSON.stringify(file()), { ...config, token: "mrt_wrong" }),
      /refused the token/,
    );
    await assert.rejects(pushRoadbookFile("{}", config), /Could not push to .*400/);
    await assert.rejects(pushRoadbookFile("{}", { url: "http://127.0.0.1:1", token: "t" }), /Could not push to/);

    const path = join(mkdtempSync(join(tmpdir(), "ride-pushfile-")), "loop.motoride.json");
    writeFileSync(path, JSON.stringify(file({ name: "From a file", origin: undefined })));
    assert.match(await pushExported(path, config), /Pushed to .*: new, version [0-9a-f]{16}/);
    await assert.rejects(pushExported(path, null), /No server to push to/);
  } finally {
    await s.app.close();
    s.registry.close();
  }
});
