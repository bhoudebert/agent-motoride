import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { installFakeServices } from "./helpers/fakeServices.ts";

const dir = mkdtempSync(join(tmpdir(), "ride-hosted-"));
process.env.RIDE_DATA_DIR = dir;
const { tenantDbPath } = await import("../src/dataDir.ts");
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { createAdminServer } = await import("../src/adminApi.ts");
const { Store } = await import("../src/store.ts");
const { riderSchema, invitationSchema, meSchema, deletedSchema, errorSchema, openApiDocument } =
  await import("../src/hostedContract.ts");

installFakeServices();

const SECRET = "s".repeat(40);
const REF = "apple:2000000123456789";
const BASE = "https://rides.example.org";

async function setup(trafficOptions: Record<string, unknown> = {}) {
  const registry = new Registry(":memory:");
  let clock = Date.UTC(2026, 10, 1, 10, 0, 0);
  const now = () => clock;
  const lines: string[] = [];
  const admin = createAdminServer({ registry, token: SECRET, baseUrl: BASE, now, log: (l) => lines.push(l) });
  await new Promise<void>((resolve) => admin.http.listen(0, "127.0.0.1", resolve));
  const app = createHttpServer({ registry, now, traffic: trafficOptions });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const adminUrl = `http://127.0.0.1:${(admin.http.address() as AddressInfo).port}`;
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token: string | null = SECRET) => {
    const r = await fetch(`${adminUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const rider = (ref = REF) => `/admin/v1/riders/${encodeURIComponent(ref)}`;
  /** Makes a rider, asks for an invitation, and enrols as the phone would: returns the phone's token. */
  const phone = async (ref = REF, entitlements?: Record<string, unknown>) => {
    await call("PUT", rider(ref), entitlements ? { entitlements } : undefined);
    const invitation = invitationSchema.parse((await call("POST", `${rider(ref)}/invitation`)).body);
    const enrolled = await fetch(`${url}/enrol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: invitation.code }),
    });
    return { invitation, status: enrolled.status, token: ((await enrolled.json()) as { token: string }).token };
  };
  const me = async (token: string) => {
    const r = await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, body: r.status === 200 ? meSchema.parse(await r.json()) : null };
  };
  const close = async () => {
    await admin.close();
    await app.close();
  };
  return { registry, call, rider, phone, me, url, close, lines, tick: (ms: number) => (clock += ms) };
}

test("with the provisioning API off nothing exists: it needs a secret of 32 characters", () => {
  const registry = new Registry(":memory:");
  assert.throws(() => createAdminServer({ registry, token: "short", baseUrl: BASE }), /at least 32/);
});

test("only the admin token opens the API", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("GET", s.rider(), undefined, null)).status, 401);
    assert.equal((await s.call("GET", s.rider(), undefined, "x".repeat(40))).status, 401);
    const made = await s.phone();
    assert.equal(made.status, 200);
    // A phone's token is not an admin token.
    assert.equal((await s.call("PUT", s.rider("other-ref-12345"), undefined, made.token)).status, 401);
    assert.equal((await s.call("GET", "/admin/v1/nothing")).status, 404);
  } finally {
    await s.close();
  }
});

test("a rider is made once by reference, whatever the number of times it is asked", async () => {
  const s = await setup();
  try {
    const first = await s.call("PUT", s.rider());
    assert.equal(first.status, 201);
    const rider = riderSchema.parse(first.body);
    assert.equal(rider.ref, REF);
    assert.equal(rider.status, "active");
    assert.deepEqual(rider.entitlements, {});
    const again = await s.call("PUT", s.rider());
    assert.equal(again.status, 200);
    assert.equal(riderSchema.parse(again.body).id, rider.id);
    assert.equal(s.registry.list().length, 1);
    assert.match(s.registry.list()[0]!.email, /@hosted\.invalid$/);
    assert.equal((await s.call("PUT", "/admin/v1/riders/short")).status, 400);
    assert.equal((await s.call("GET", s.rider("unknown-ref-1234"))).status, 404);
  } finally {
    await s.close();
  }
});

test("an invitation enrols the phone once, and not a suspended rider", async () => {
  const s = await setup();
  try {
    const made = await s.phone();
    assert.equal(made.status, 200);
    assert.match(made.token, /^mrt_/);
    assert.match(made.invitation.link, /^mobilemotoride:\/\/server\?url=https%3A%2F%2Frides\.example\.org&code=mri_/);
    const reuse = await fetch(`${s.url}/enrol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: made.invitation.code }),
    });
    assert.equal(reuse.status, 404);
    assert.equal((await s.me(made.token)).status, 200);
    assert.equal(riderSchema.parse((await s.call("POST", `${s.rider()}/suspend`)).body).status, "suspended");
    // Shut out at once, but /me still says why, so the app can show "paused" and not "bad token".
    const rides = await fetch(`${s.url}/rides`, { headers: { Authorization: `Bearer ${made.token}` } });
    assert.equal(rides.status, 401, "a suspended rider is shut out at once");
    const paused = await s.me(made.token);
    assert.equal(paused.status, 200);
    assert.deepEqual(paused.body!.suspended, { reason: "lapsed", until: null });
    const until = "2026-12-01T00:00:00.000Z";
    await s.call("POST", `${s.rider()}/suspend`, { reason: "billing_retry", until });
    assert.deepEqual((await s.me(made.token)).body!.suspended, { reason: "billing_retry", until });
    assert.equal((await s.call("POST", `${s.rider()}/suspend`, { reason: "Bad Reason!" })).status, 400);
    const refused = await s.call("POST", `${s.rider()}/invitation`);
    assert.equal(refused.status, 409);
    errorSchema.parse(refused.body);
    await s.call("POST", `${s.rider()}/resume`);
    assert.equal((await s.me(made.token)).body!.suspended, undefined);
    assert.equal((await fetch(`${s.url}/rides`, { headers: { Authorization: `Bearer ${made.token}` } })).status, 200);
    assert.equal((await s.call("POST", `${s.rider()}/invitation`, { minutes: 90 })).status, 400);
  } finally {
    await s.close();
  }
});

test("entitlements are checked and replaced as a whole", async () => {
  const s = await setup();
  try {
    await s.call("PUT", s.rider());
    const set = await s.call("PUT", `${s.rider()}/entitlements`, { traffic: "open", libraryMb: 50 });
    assert.deepEqual(riderSchema.parse(set.body).entitlements, { traffic: "open", libraryMb: 50 });
    const replaced = await s.call("PUT", `${s.rider()}/entitlements`, { requestsPerMinute: 100 });
    assert.deepEqual(riderSchema.parse(replaced.body).entitlements, { requestsPerMinute: 100 });
    for (const bad of [
      { traffic: "gold" },
      { libraryMb: 0 },
      { trafficPerDay: -1 },
      { colour: "red" },
      { requestsPerMinute: 5 },
    ]) {
      const r = await s.call("PUT", `${s.rider()}/entitlements`, bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(errorSchema.parse(r.body).error, "invalid_entitlements");
    }
    assert.deepEqual(riderSchema.parse((await s.call("GET", s.rider())).body).entitlements, { requestsPerMinute: 100 });
    // Set at creation, and taken away with an empty set.
    const other = await s.call("PUT", s.rider("google:other-subscription"), { entitlements: { traffic: "off" } });
    assert.deepEqual(riderSchema.parse(other.body).entitlements, { traffic: "off" });
    assert.equal(
      (await s.call("PUT", s.rider("google:other-subscription"), { entitlements: { traffic: "x" } })).status,
      400,
    );
    assert.deepEqual(
      riderSchema.parse((await s.call("PUT", `${s.rider("google:other-subscription")}/entitlements`, {})).body)
        .entitlements,
      {},
    );
  } finally {
    await s.close();
  }
});

test("GET /me says what the rider may use, and a change applies to the next request", async () => {
  const s = await setup();
  try {
    const { token } = await s.phone(REF, {
      traffic: "tomtom",
      trafficPerDay: 40,
      libraryMb: 5,
      requestsPerMinute: 200,
    });
    const first = (await s.me(token)).body!;
    assert.equal(first.hosted, true);
    // This host has no TomTom provider, so the source that answers is open data, and /me says so.
    assert.deepEqual(first.traffic, { mode: "tomtom", perDay: 40, usedToday: 0, provider: "open" });
    assert.equal(first.library.limitMb, 5);
    assert.equal(first.requestsPerMinute, 200);
    await s.call("PUT", `${s.rider()}/entitlements`, { traffic: "open" });
    assert.deepEqual((await s.me(token)).body!.traffic, { mode: "open", perDay: null, usedToday: 0 });
    // A rider an administrator added is not hosted and has the host's defaults.
    const added = s.registry.add("alice@example.org");
    const plain = (await s.me(added.token)).body!;
    assert.equal(plain.hosted, false);
    assert.equal(plain.traffic.mode, "host");
    assert.equal(plain.requestsPerMinute, 300);
    assert.equal((await s.me("mrt_nope")).status, 401);
  } finally {
    await s.close();
  }
});

test("GET /me says which source answers the rider's traffic, also when the host decides", async () => {
  const s = await setup({ provider: "tomtom-flow", key: "k", perDay: 10 });
  try {
    const host = await s.phone("apple:provider-host-0001");
    assert.equal((await s.me(host.token)).body!.traffic.provider, "tomtom");
    const open = await s.phone("apple:provider-open-0001", { traffic: "open" });
    assert.equal((await s.me(open.token)).body!.traffic.provider, "open");
    const off = await s.phone("apple:provider-off-00001", { traffic: "off" });
    assert.equal((await s.me(off.token)).body!.traffic.provider, undefined);
  } finally {
    await s.close();
  }
});

test("traffic: off is refused, open is open data, tomtom is counted against the day", async () => {
  const flows: string[] = [];
  const s = await setup({
    provider: "tomtom-flow",
    key: "k",
    perDay: 1000,
    fetch: async (u: string) => {
      flows.push(u);
      return { flowSegmentData: { currentSpeed: 50, freeFlowSpeed: 50, confidence: 1 } };
    },
  });
  try {
    const points = (n: number) => ({ points: Array.from({ length: n }, (_, i) => [50 + i / 10, 3]) });
    const post = (token: string, body: unknown) =>
      fetch(`${s.url}/traffic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    const off = await s.phone("apple:traffic-off-0001", { traffic: "off" });
    const refused = await post(off.token, points(2));
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: "traffic_not_included" });
    assert.equal(flows.length, 0, "TomTom was not called");

    const paid = await s.phone("apple:traffic-paid-0001", { traffic: "tomtom", trafficPerDay: 3 });
    assert.equal((await post(paid.token, points(2))).status, 200);
    assert.equal(flows.length, 2);
    assert.equal((await s.me(paid.token)).body!.traffic.usedToday, 2);
    const over = await post(paid.token, points(2));
    assert.equal(over.status, 429);
    assert.deepEqual(await over.json(), { error: "daily_limit" });
    assert.equal(flows.length, 2, "TomTom was not called again");
    assert.equal((await post(paid.token, points(1))).status, 200, "what is left of the allowance can still be used");
    s.tick(24 * 3_600_000);
    assert.equal((await post(paid.token, points(2))).status, 200, "the allowance renews at 00:00 UTC");

    // `open` is served from open data, never from TomTom, and a rider with no plan has the host's choice.
    const open = await s.phone("apple:traffic-open-0001", { traffic: "open" });
    const before = flows.length;
    const answered = await post(open.token, { points: [[50.6, 3.1]] });
    assert.notEqual(answered.status, 403);
    assert.equal(flows.length, before, "TomTom was not called for an open rider");
    const plain = s.registry.add("bob@example.org");
    assert.equal((await post(plain.token, points(1))).status, 200);
  } finally {
    await s.close();
  }
});

test("the traffic tool follows the plan too", async () => {
  process.env.TOMTOM_API_KEY = "k";
  const s = await setup();
  try {
    const ask = async (token: string) => {
      const client = new Client({ name: "t", version: "0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      await client.callTool({ name: "rideSettings", arguments: { home: "Lille" } });
      const r = (await client.callTool({
        name: "getTraffic",
        arguments: { waypoints: ["Lille", "Cassel"], departAt: "2026-11-02T09:00:00" },
      })) as { content: Array<{ text: string }> };
      await client.close();
      return r.content[0]!.text;
    };
    const off = await s.phone("apple:tool-off-00001", { traffic: "off" });
    assert.match(await ask(off.token), /not included in this rider's plan/);
    const open = await s.phone("apple:tool-open-0001", { traffic: "open" });
    assert.match(await ask(open.token), /not included in this rider's plan/);
    const spent = await s.phone("apple:tool-zero-0001", { traffic: "tomtom", trafficPerDay: 0 });
    assert.match(await ask(spent.token), /allowance is used up/);
  } finally {
    delete process.env.TOMTOM_API_KEY;
    await s.close();
  }
});

test("a library has a size limit for uploads and a rate of its own", async () => {
  const s = await setup();
  try {
    const { token } = await s.phone("apple:library-0000001", { libraryMb: 1, requestsPerMinute: 12 });
    const put = (id: string, body: string) =>
      fetch(`${s.url}/rides/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/gpx+xml", Authorization: `Bearer ${token}` },
        body,
      });
    const big = await put("2026-11-01T10-00-00Z-big", "x".repeat(1_100_000));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: "library_full" });
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await s.me(token)).status);
    assert.ok(statuses.includes(429), `no 429 in ${statuses.join(",")}`);
    s.tick(61_000);
    assert.equal((await s.me(token)).status, 200);
  } finally {
    await s.close();
  }
});

test("a rider may have several phones, and a lost phone is cut off without touching the rider", async () => {
  const s = await setup();
  try {
    const first = await s.phone();
    assert.equal(riderSchema.parse((await s.call("GET", s.rider())).body).devices, 1);
    const second = await s.phone();
    const seen = riderSchema.parse((await s.call("GET", s.rider())).body);
    assert.equal(seen.devices, 2);
    assert.ok(seen.enrolledAt);
    assert.equal((await s.me(first.token)).status, 200);
    assert.equal((await s.me(second.token)).status, 200);

    const cut = await s.call("DELETE", `${s.rider()}/devices`);
    assert.deepEqual(cut.body, { ref: REF, revoked: 2 });
    assert.equal((await s.me(first.token)).status, 401);
    assert.equal((await s.me(second.token)).status, 401);
    const after = riderSchema.parse((await s.call("GET", s.rider())).body);
    assert.equal(after.devices, 0);
    assert.equal(after.enrolledAt, null);
    assert.equal(after.status, "active");

    const third = await s.phone();
    assert.equal((await s.me(third.token)).status, 200);
    assert.equal((await s.call("DELETE", `${s.rider("apple:unknown-0001")}/devices`)).status, 404);
  } finally {
    await s.close();
  }
});

test("GET /me gives the same opaque rider reference on every phone, and not the identifier", async () => {
  const s = await setup();
  try {
    const first = await s.phone();
    const second = await s.phone();
    const a = (await s.me(first.token)).body!;
    const b = (await s.me(second.token)).body!;
    assert.match(a.riderRef, /^rr-[0-9a-f]{16}$/);
    assert.equal(a.riderRef, b.riderRef);
    const id = riderSchema.parse((await s.call("GET", s.rider())).body).id;
    assert.equal(a.riderRef, `rr-${id.replaceAll("-", "").slice(0, 16)}`);
    const other = await s.phone("apple:another-rider-0002");
    assert.notEqual((await s.me(other.token)).body!.riderRef, a.riderRef);
  } finally {
    await s.close();
  }
});

test("deleting a rider removes the library and the phone's access, and frees the reference", async () => {
  const s = await setup();
  try {
    const { token } = await s.phone();
    const id = riderSchema.parse((await s.call("GET", s.rider())).body).id;
    new Store(tenantDbPath(id)).close();
    assert.ok(existsSync(tenantDbPath(id)));
    const gone = await s.call("DELETE", s.rider());
    assert.equal(gone.status, 200);
    assert.deepEqual(deletedSchema.parse(gone.body), { ref: REF, deleted: true });
    assert.equal(existsSync(tenantDbPath(id)), false);
    assert.equal((await s.me(token)).status, 401);
    assert.equal((await s.call("GET", s.rider())).status, 404);
    assert.equal((await s.call("DELETE", s.rider())).status, 404);
    assert.equal((await s.call("PUT", s.rider())).status, 201, "the reference can be used again");
  } finally {
    await s.close();
  }
});

test("the log has one line a call and never a token, a code or a reference", async () => {
  const s = await setup();
  try {
    const made = await s.phone();
    await s.call("PUT", `${s.rider()}/entitlements`, { traffic: "open" });
    await s.call("GET", s.rider(), undefined, null);
    const log = s.lines.join("\n");
    assert.match(log, /\[admin\] PUT rider [0-9a-f]{8} 201/);
    assert.match(log, /\[admin\] POST invitation [0-9a-f]{8} 200/);
    assert.match(log, /\[admin\] GET - - 401/);
    for (const secret of [SECRET, REF, "2000000123456789", made.invitation.code, made.token])
      assert.ok(!log.includes(secret), `a secret in the log: ${secret}`);
  } finally {
    await s.close();
  }
});

test("the description of the API is the one the code makes, and every call answers as described", async () => {
  const file = readFileSync(new URL("../docs/hosted-provisioning.openapi.json", import.meta.url), "utf8");
  // Compared as data: prettier lays the file out its own way.
  assert.deepEqual(JSON.parse(file), JSON.parse(JSON.stringify(openApiDocument())), "run: npm run docs:contract");
  const s = await setup();
  try {
    const doc = openApiDocument() as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
    const ref = "apple:contract-check-0001";
    const bodies: Record<string, unknown> = {
      "PUT /admin/v1/riders/{ref}": { entitlements: { traffic: "open" } },
      "PUT /admin/v1/riders/{ref}/entitlements": { libraryMb: 10 },
    };
    const order = ["put", "get", "post", "delete"];
    const calls: Array<[string, string, string]> = [];
    for (const [path, methods] of Object.entries(doc.paths))
      for (const method of Object.keys(methods).filter((m) => order.includes(m))) calls.push([method, path, path]);
    // A rider has to exist first and be deleted last.
    calls.sort(
      (a, b) =>
        Number(a[0] === "delete") - Number(b[0] === "delete") || Number(b[0] === "put") - Number(a[0] === "put"),
    );
    const phone = await s.phone(ref);
    for (const [method, path] of calls) {
      if (path === "/me") {
        const r = await fetch(`${s.url}/me`, { headers: { Authorization: `Bearer ${phone.token}` } });
        assert.ok(String(r.status) in doc.paths[path]![method]!.responses, `GET /me answered ${r.status}`);
        continue;
      }
      const real = path.replace("{ref}", encodeURIComponent(ref));
      const r = await s.call(method.toUpperCase(), real, bodies[`${method.toUpperCase()} ${path}`]);
      assert.ok(
        String(r.status) in doc.paths[path]![method]!.responses,
        `${method.toUpperCase()} ${path} answered ${r.status}, which the description does not give`,
      );
    }
  } finally {
    await s.close();
  }
});
