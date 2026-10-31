import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

process.env.RIDE_DATA_DIR = mkdtempSync(join(tmpdir(), "ride-rec-"));
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { importRoadbookFile } = await import("../src/importRoadbook.ts");
const { Store } = await import("../src/store.ts");
const { tenantDbPath } = await import("../src/dataDir.ts");
const { encodePolyline, bentLine } = await import("./helpers/polyline.ts");

/** A GPX as the phone writes it; `source` names the roadbook it followed, none for a free-roaming ride. */
function gpx(
  source?: { app: string; roadbook: number; name: string },
  count = 30,
  name = "Pays des Collines loop, 2026-10-31",
) {
  const attrs = source ? ` source="${source.app}" sourceRoadbook="${source.roadbook}" sourceName="${source.name}"` : "";
  const pts = Array.from({ length: count }, (_, i) => {
    const time = new Date(Date.UTC(2026, 9, 31, 9, 0, i)).toISOString();
    return `<trkpt lat="${(50.45 + i * 0.0002).toFixed(6)}" lon="3.200000"><ele>42.3</ele><time>${time}</time><extensions><motoride:speed>17.4</motoride:speed></extensions></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0"?><gpx version="1.1" creator="MotoRide" xmlns="http://www.topografix.com/GPX/1/1" xmlns:motoride="https://example.org/m"><metadata><name>${name}</name><extensions><motoride:ride roadbook="x" name="Pays des Collines loop"${attrs} state="completed" climbM="412" peakLeftDeg="38" peakRightDeg="41"/></extensions></metadata><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

async function setup() {
  const registry = new Registry(":memory:");
  const alice = registry.add("alice@example.org");
  const bob = registry.add("bob@example.org");
  const app = createHttpServer({ registry });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const req = (
    method: string,
    path: string,
    token?: string,
    body?: string | Buffer,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : new Uint8Array(typeof body === "string" ? Buffer.from(body) : body),
    });
  const close = async () => {
    await app.close();
    registry.close();
  };
  return { alice, bob, req, close };
}

test("an uploaded ride is kept in the library, listed, read back, and deleted on the server only", async () => {
  const s = await setup();
  try {
    const id = "2026-10-31T09-00-00-pays-des-collines-loop";
    assert.equal((await s.req("PUT", `/rides/${id}`, undefined, gpx())).status, 401);
    assert.equal((await s.req("GET", "/rides")).status, 401);

    const put = await s.req("PUT", `/rides/${id}`, s.alice.token, gpx());
    assert.equal(put.status, 201);
    assert.deepEqual(await put.json(), { id, status: "created", roadbook: null }, "free-roaming: kept, no roadbook");

    const list = (await (await s.req("GET", "/rides", s.alice.token)).json()) as {
      rides: Array<{
        id: string;
        name: string;
        points: number;
        distanceKm: number;
        startedAt: string;
        roadbook: unknown;
      }>;
    };
    assert.equal(list.rides.length, 1);
    assert.deepEqual(
      [
        list.rides[0]!.id,
        list.rides[0]!.name,
        list.rides[0]!.points,
        list.rides[0]!.startedAt,
        list.rides[0]!.roadbook,
      ],
      [id, "Pays des Collines loop", 30, "2026-10-31T09:00:00.000Z", null],
    );
    assert.ok(list.rides[0]!.distanceKm > 0.5 && list.rides[0]!.distanceKm < 1);

    const back = await s.req("GET", `/rides/${id}`, s.alice.token);
    assert.equal(back.status, 200);
    assert.equal(back.headers.get("content-type"), "application/gpx+xml; charset=utf-8");
    assert.equal(await back.text(), gpx(), "the GPX comes back as it was sent");

    // Another rider never sees it.
    assert.deepEqual(((await (await s.req("GET", "/rides", s.bob.token)).json()) as { rides: unknown[] }).rides, []);
    assert.equal((await s.req("GET", `/rides/${id}`, s.bob.token)).status, 404);
    assert.equal((await s.req("DELETE", `/rides/${id}`, s.bob.token)).status, 404);

    assert.equal((await s.req("DELETE", `/rides/${id}`, s.alice.token)).status, 200);
    assert.equal((await s.req("DELETE", `/rides/${id}`, s.alice.token)).status, 404);
    assert.equal((await s.req("GET", `/rides/${id}`, s.alice.token)).status, 404);
    assert.equal((await s.req("POST", "/rides", s.alice.token)).status, 405);
  } finally {
    await s.close();
  }
});

test("the same ride sent again changes nothing; other content under the same id replaces it", async () => {
  const s = await setup();
  try {
    const id = "ride-a";
    assert.equal((await s.req("PUT", `/rides/${id}`, s.alice.token, gpx())).status, 201);
    const again = await s.req("PUT", `/rides/${id}`, s.alice.token, gpx());
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { status: string }).status, "unchanged");
    const fixed = await s.req("PUT", `/rides/${id}`, s.alice.token, gpx(undefined, 40));
    assert.equal(fixed.status, 200);
    assert.equal(((await fixed.json()) as { status: string }).status, "replaced");
    const rides = ((await (await s.req("GET", "/rides", s.alice.token)).json()) as { rides: Array<{ points: number }> })
      .rides;
    assert.deepEqual(
      rides.map((r) => r.points),
      [40],
      "one ride, the new content",
    );
  } finally {
    await s.close();
  }
});

test("a gzip upload is accepted, a bad one refused", async () => {
  const s = await setup();
  try {
    const zipped = await s.req("PUT", "/rides/zipped", s.alice.token, gzipSync(gpx()), { "Content-Encoding": "gzip" });
    assert.equal(zipped.status, 201);
    assert.equal(await (await s.req("GET", "/rides/zipped", s.alice.token)).text(), gpx());
    assert.equal(
      (await s.req("PUT", "/rides/bad", s.alice.token, "not gzip", { "Content-Encoding": "gzip" })).status,
      400,
    );
    assert.equal((await s.req("PUT", "/rides/br", s.alice.token, gpx(), { "Content-Encoding": "br" })).status, 415);
  } finally {
    await s.close();
  }
});

test("what is not a ride is refused: a bad id, no track, a planned route without times, too large", async () => {
  const s = await setup();
  try {
    assert.equal((await s.req("PUT", "/rides/a%20b", s.alice.token, gpx())).status, 400);
    assert.equal((await s.req("PUT", "/rides/empty", s.alice.token, "")).status, 400);
    assert.equal((await s.req("PUT", "/rides/json", s.alice.token, '{"a":1}')).status, 400);
    const planned = gpx().replace(/<time>[^<]*<\/time>/g, "");
    assert.equal((await s.req("PUT", "/rides/planned", s.alice.token, planned)).status, 400);
    assert.equal(
      (await s.req("PUT", "/rides/big", s.alice.token, Buffer.alloc(25 * 1024 * 1024 + 1, "a"))).status,
      413,
    );
    // A small zip that unzips to too much is refused too.
    const bomb = gzipSync(Buffer.alloc(26 * 1024 * 1024, "a"));
    assert.equal((await s.req("PUT", "/rides/bomb", s.alice.token, bomb, { "Content-Encoding": "gzip" })).status, 413);
    assert.deepEqual(((await (await s.req("GET", "/rides", s.alice.token)).json()) as { rides: unknown[] }).rides, []);
  } finally {
    await s.close();
  }
});

test("a ride is linked to the roadbook of the library it followed: one planned here, or one sent from another library", async () => {
  const s = await setup();
  try {
    const points = bentLine({ lat: 50.4, lon: 3.0 }, { lat: 50.5, lon: 3.2 }, 41, 0.01);
    const pushed = {
      format: "motoride-roadbook",
      version: 1,
      name: "Device loop",
      line: encodePolyline(points),
      stops: [],
      limits: [],
      cameras: [],
      origin: { app: "agentRide", roadbook: 7, name: "Device loop" },
    };
    const store = new Store(tenantDbPath(s.alice.tenant.id));
    const { id: roadbookId } = importRoadbookFile(store, pushed);
    store.close();

    // The phone's file for a sent roadbook carries the sender's number and name.
    const sent = await s.req(
      "PUT",
      "/rides/sent",
      s.alice.token,
      gpx({ app: "agentRide", roadbook: 7, name: "Device loop" }),
    );
    assert.deepEqual(((await sent.json()) as { roadbook: unknown }).roadbook, { id: roadbookId, name: "Device loop" });

    // A roadbook that is not in this library (another number) leaves the ride free.
    const other = await s.req(
      "PUT",
      "/rides/other",
      s.alice.token,
      gpx({ app: "agentRide", roadbook: 99, name: "Elsewhere" }),
    );
    assert.equal(((await other.json()) as { roadbook: unknown }).roadbook, null);

    // The roadbook is linked only while it is in the library.
    const del = new Store(tenantDbPath(s.alice.tenant.id));
    del.deleteRide(roadbookId);
    del.close();
    const list = (
      (await (await s.req("GET", "/rides", s.alice.token)).json()) as {
        rides: Array<{ id: string; roadbook: unknown }>;
      }
    ).rides;
    assert.ok(
      list.every((r) => r.roadbook === null),
      "a ride outlives its roadbook",
    );
  } finally {
    await s.close();
  }
});

test("a library keeps at most 200 rides; replacing one is still allowed at the limit", async () => {
  const { keepRide, MAX_RECORDED_RIDES, RideRefused } = await import("../src/recordedRides.ts");
  const store = new Store(join(mkdtempSync(join(tmpdir(), "ride-cap-")), "rides.db"));
  try {
    for (let i = 0; i < MAX_RECORDED_RIDES; i++) keepRide(store, `r${i}`, gpx(undefined, 3));
    assert.throws(
      () => keepRide(store, "one-more", gpx(undefined, 3)),
      (e) => e instanceof RideRefused && e.status === 409,
    );
    assert.equal(keepRide(store, "r0", gpx(undefined, 4)).status, "replaced");
  } finally {
    store.close();
  }
});

test("the list carries what a card shows: state, climb, peak leans (when the header has them), the size, and the roadbook's name", async () => {
  const s = await setup();
  try {
    await s.req("PUT", "/rides/with", s.alice.token, gpx());
    const bare = gpx(undefined, 30, "Free ride, 2026-10-31").replace(
      / name="Pays des Collines loop"| state="completed"| climbM="412"| peakLeftDeg="38"| peakRightDeg="41"/g,
      "",
    );
    await s.req("PUT", "/rides/bare", s.alice.token, bare);
    const { rides } = (await (await s.req("GET", "/rides", s.alice.token)).json()) as {
      rides: Array<Record<string, unknown>>;
    };
    const by = Object.fromEntries(rides.map((r) => [r["id"], r]));
    assert.deepEqual(
      [
        by["with"]!["name"],
        by["with"]!["state"],
        by["with"]!["climbM"],
        by["with"]!["peakLeftDeg"],
        by["with"]!["peakRightDeg"],
      ],
      ["Pays des Collines loop", "completed", 412, 38, 41],
      "the roadbook's name, not the title with the date",
    );
    assert.equal(by["with"]!["bytes"], Buffer.byteLength(gpx()));
    assert.equal(typeof by["with"]!["distanceKm"], "number");
    assert.match(String(by["with"]!["uploadedAt"]), /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    assert.equal(by["bare"]!["name"], "Free ride, 2026-10-31", "no header name: the title");
    for (const key of ["state", "climbM", "peakLeftDeg", "peakRightDeg"])
      assert.ok(!(key in by["bare"]!), `${key} is left out when the header has none`);
  } finally {
    await s.close();
  }
});
