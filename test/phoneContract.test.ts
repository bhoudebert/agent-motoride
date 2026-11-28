// What the MotoRide phone app reads from the server, pinned (the phone is a separate app that is not updated with the server):
// the paths it calls, the JSON it parses and the GPX it uploads. A change to anything below changes what a phone sees.
// Intended changes: run `UPDATE_PHONE_CONTRACT=1 npm test -- test/phoneContract.test.ts`, read the diff of the golden file,
// and make sure the phone's own source (mobile-motoride: src/core/serverRoadbooks.ts, serverRides.ts, services/) still reads it.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.RIDE_DATA_DIR = mkdtempSync(join(tmpdir(), "ride-phone-contract-"));
const { installFakeServices } = await import("./helpers/fakeServices.ts");
installFakeServices();
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { tenantDbPath } = await import("../src/dataDir.ts");
const { DEFAULT_PREFERENCES } = await import("../src/preferences.ts");
const { Store } = await import("../src/store.ts");
const { bentLine, encodePolyline } = await import("./helpers/polyline.ts");

const GOLDEN = new URL("./golden/phone-contract.json", import.meta.url);
const line = bentLine({ lat: 50.4, lon: 3.0 }, { lat: 50.42, lon: 3.0 }, 61);

/** What changes from one run to the next (times, tokens, random references, the size of the database file) is replaced. */
function steady(value: unknown, key = ""): unknown {
  if (key === "usedBytes") return "<n>";
  if (typeof value === "string")
    return value
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<ts>")
      .replace(/mrt_[A-Za-z0-9_-]+/g, "<token>")
      .replace(/rr-[0-9a-f]+/g, "<ref>");
  if (Array.isArray(value)) return value.map((v) => steady(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, steady(v, k)]),
    );
  return value;
}

async function capture(): Promise<Record<string, unknown>> {
  const registry = new Registry(":memory:");
  const alice = registry.add("alice@example.org");
  const store = new Store(tenantDbPath(alice.tenant.id));
  const id = store.saveRide({
    name: "Contract loop",
    parentId: null,
    home: "Lille",
    rideDate: "2026-12-05",
    departure: "09:00",
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
    shapes: [encodePolyline(line)],
    centerLat: 50.41,
    centerLon: 3,
    usage: null,
    extras: null,
    legs: [
      {
        seq: 1,
        from: "Lille",
        to: "Mont",
        fromCoords: "50.4,3",
        toCoords: "50.42,3",
        distanceKm: 2.2,
        ridingMinutes: 3,
        mainRoads: ["D 955"],
      },
    ],
  });
  store.close();
  const app = createHttpServer({ registry, mapDay: async () => "2026-11-01" });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const out: Record<string, unknown> = {};
  const hit = async (
    label: string,
    method: string,
    path: string,
    body?: string,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(base + path, {
      method,
      headers: label === "health" ? headers : { Authorization: `Bearer ${alice.token}`, ...headers },
      body,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON: a GPX */
    }
    const kept = ["content-type", "etag", "cache-control", "www-authenticate", "allow"];
    out[label] = steady({
      status: res.status,
      headers: Object.fromEntries(kept.map((h) => [h, res.headers.get(h)])),
      body: parsed,
    });
  };
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="MotoRide" xmlns="http://www.topografix.com/GPX/1/1" xmlns:motoride="https://example.org/m"><metadata><name>Contract loop, 2026-10-31</name><extensions><motoride:ride roadbook="x" name="Contract loop" source="MotoRide" sourceRoadbook="${id}" sourceName="Contract loop" state="completed"/></extensions></metadata><trk><trkseg>${Array.from({ length: 10 }, (_, i) => `<trkpt lat="${(50.4 + i * 0.0002).toFixed(6)}" lon="3.000000"><time>2026-10-31T09:00:${String(i).padStart(2, "0")}Z</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
  const json = { "Content-Type": "application/json" };
  try {
    await hit("health", "GET", "/health");
    await hit("me", "GET", "/me");
    await hit("roadbooks list", "GET", "/roadbooks");
    await hit("roadbook file", "GET", `/roadbook/${id}`);
    await hit("roadbook refresh", "POST", `/roadbook/${id}/refresh`);
    await hit("roadbooks list after refresh", "GET", "/roadbooks");
    await hit("ride upload", "PUT", "/rides/2026-10-31T09-00-00-contract-loop", gpx, {
      "Content-Type": "application/gpx+xml",
    });
    await hit("rides list", "GET", "/rides");
    await hit("ride read back", "GET", "/rides/2026-10-31T09-00-00-contract-loop");
    await hit("ride delete", "DELETE", "/rides/2026-10-31T09-00-00-contract-loop");
    await hit(
      "route",
      "POST",
      "/route",
      JSON.stringify({
        locations: [
          { lat: 50.4, lon: 3 },
          { lat: 50.42, lon: 3 },
        ],
        costing: "motorcycle",
      }),
      json,
    );
    await hit("route refused", "POST", "/route", JSON.stringify({ locations: [] }), json);
    await hit("roadbook unknown", "GET", "/roadbook/99");
    await hit("roadbooks wrong method", "DELETE", "/roadbooks");
  } finally {
    await app.close();
    registry.close();
  }
  return out;
}

test("the server answers the phone as the pinned contract says (paths, JSON, GPX)", async () => {
  const seen = await capture();
  if (process.env.UPDATE_PHONE_CONTRACT) {
    writeFileSync(GOLDEN, `${JSON.stringify(seen, null, 2)}\n`);
    return;
  }
  const pinned = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(seen), Object.keys(pinned), "the same endpoints are captured");
  for (const label of Object.keys(pinned))
    assert.deepEqual(seen[label], pinned[label], `what the phone reads from "${label}"`);
});
