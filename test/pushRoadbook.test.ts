import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The data folder is read when the modules load: point it at a scratch folder first.
process.env.RIDE_DATA_DIR = mkdtempSync(join(tmpdir(), "ride-push-"));
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { PushedRoadbooks, PUSHED_ID_BASE, PushRefused, fileStamp } = await import("../src/pushedRoadbooks.ts");
const { remoteConfig, pushRoadbookFile, pushExported } = await import("../src/remote.ts");
const { encodePolyline } = await import("./helpers/polyline.ts");

const line = encodePolyline([
  { lat: 50.4, lon: 3.0 },
  { lat: 50.41, lon: 3.02 },
  { lat: 50.42, lon: 3.05 },
]);
const file = (extra: Record<string, unknown> = {}) => ({
  format: "motoride-roadbook",
  version: 1,
  name: "Device loop",
  description: "122.3 km, about 2h05 riding.",
  generatedAt: "2026-10-30T10:00:00.000Z",
  line,
  stops: [],
  limits: [],
  cameras: [],
  junctions: [],
  countries: [],
  origin: { app: "agentRide", roadbook: 7, name: "Device loop" },
  ...extra,
});

test("pushed roadbooks: a push is kept, the same roadbook replaces it, the stamp ignores the time it was made", () => {
  const box = new PushedRoadbooks(join(mkdtempSync(join(tmpdir(), "ride-box-")), "pushed"));
  assert.deepEqual(box.list(), []);
  const first = box.put(file());
  assert.equal(first.replaced, false);
  assert.ok(first.id >= PUSHED_ID_BASE);
  const again = box.put(file({ generatedAt: "2026-10-31T10:00:00.000Z" }));
  assert.deepEqual(again, { id: first.id, stamp: first.stamp, replaced: true }, "same content, same version");
  const changed = box.put(file({ name: "Device loop", limits: [{ from: 0, to: 2, kmh: 50, posted: false }] }));
  assert.equal(changed.id, first.id);
  assert.notEqual(changed.stamp, first.stamp);
  // Another roadbook of the same library, and a file with no origin, keep their own places.
  const other = box.put(file({ origin: { app: "agentRide", roadbook: 8, name: "Other" }, name: "Other" }));
  const plain = box.put(file({ origin: undefined, name: "Plain" }));
  assert.equal(new Set([first.id, other.id, plain.id]).size, 3);
  assert.deepEqual(
    box.list().map((r) => [r.name, r.ridingMinutes]),
    [
      ["Device loop", 125],
      ["Other", 125],
      ["Plain", 125],
    ],
  );
  assert.equal(JSON.parse(box.get(first.id)!.body).limits.length, 1);
  assert.equal(box.get(PUSHED_ID_BASE + 999), null);
  assert.equal(fileStamp(file()), fileStamp(file({ generatedAt: "other" })));
});

test("pushed roadbooks: what is not a roadbook file is refused", () => {
  const box = new PushedRoadbooks(join(mkdtempSync(join(tmpdir(), "ride-box-")), "pushed"));
  for (const bad of [
    null,
    [],
    "x",
    file({ format: "gpx" }),
    file({ version: 2 }),
    file({ name: "" }),
    file({ line: "" }),
  ])
    assert.throws(() => box.put(bad), PushRefused);
});

async function setup() {
  const registry = new Registry(":memory:");
  const alice = registry.add("alice@example.org");
  const bob = registry.add("bob@example.org");
  const app = createHttpServer({ registry, makeRoadbookFile: async () => "{}" });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const req = (method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  return { registry, alice, bob, app, url, req };
}

test("the server keeps a pushed roadbook for its rider, lists it with the library, and serves it as it was", async () => {
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
    assert.ok(kept.id >= PUSHED_ID_BASE);

    const list = (await (await s.req("GET", "/roadbooks", s.alice.token)).json()) as {
      roadbooks: Array<{ id: number; name: string; stamp: string }>;
    };
    assert.deepEqual(
      list.roadbooks.map((r) => [r.id, r.name, r.stamp]),
      [[kept.id, "Device loop", kept.stamp]],
    );
    const got = await s.req("GET", `/roadbook/${kept.id}`, s.alice.token);
    assert.equal(got.headers.get("etag"), `"${kept.stamp}"`);
    assert.equal(((await got.json()) as { name: string }).name, "Device loop");
    assert.equal(
      (await s.req("GET", `/roadbook/${kept.id}`, s.alice.token, undefined, { "If-None-Match": `"${kept.stamp}"` }))
        .status,
      304,
    );

    // Bob sees nothing of Alice's, not even by number.
    const bobs = (await (await s.req("GET", "/roadbooks", s.bob.token)).json()) as { roadbooks: unknown[] };
    assert.deepEqual(bobs.roadbooks, []);
    assert.equal((await s.req("GET", `/roadbook/${kept.id}`, s.bob.token)).status, 404);
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
