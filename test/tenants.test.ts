import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { NewRide } from "../src/store.ts";

// The data folder is read when the modules load: point it at a scratch folder first.
const dir = mkdtempSync(join(tmpdir(), "ride-tenants-"));
process.env.RIDE_DATA_DIR = dir;
const { assertTenantId, tenantDbPath } = await import("../src/dataDir.ts");
const { backupAll, librarySize, newToken, Registry, removeLibrary } = await import("../src/tenants.ts");
const { Store } = await import("../src/store.ts");
const { connectionText, listText, run } = await import("../src/admin.ts");

const ride = (name: string): NewRide => ({
  name,
  parentId: null,
  home: "Lille",
  rideDate: null,
  departure: null,
  distanceKm: 50,
  ridingMinutes: 60,
  waypoints: ["Lille", "Cassel"],
  roundTrip: true,
  speedLimits: {},
  preferences: { avoidMotorways: true, max30Pct: 3, max50Pct: 20 },
  request: "a loop",
  itinerary: "text",
  mapsUrl: "m",
  cells: [],
  shapes: [],
  centerLat: 50.5,
  centerLon: 3.2,
  usage: null,
  extras: null,
  legs: [
    {
      seq: 1,
      from: "Lille",
      to: "Cassel",
      fromCoords: "50,3",
      toCoords: "50.8,2.5",
      distanceKm: 50,
      ridingMinutes: 60,
      mainRoads: [],
    },
  ],
});

test("a rider is registered by email with a random identifier and a token shown once", () => {
  const registry = new Registry(":memory:");
  const { tenant, token } = registry.add("  Alice@Example.ORG ");
  assert.equal(tenant.email, "alice@example.org");
  assert.equal(tenant.status, "active");
  assert.match(tenant.id, /^[A-Za-z0-9_-]{16}$/);
  assert.ok(!tenant.id.includes("alice"), "the identifier says nothing of the email");
  assert.match(token, /^mrt_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(registry.add("bob@example.org").tenant.id, tenant.id);
  assert.notEqual(newToken(), newToken());
  assert.throws(() => registry.add("alice@example.org"), /already registered/);
  assert.throws(() => registry.add("ALICE@example.org"), /already registered/);
  for (const bad of ["", "alice", "a@b", "a b@c.d"]) assert.throws(() => registry.add(bad), /not an email/, bad);
});

test("only a hash of the token is kept", () => {
  const path = join(dir, "hashes.db");
  const registry = new Registry(path);
  const { token } = registry.add("hash@example.org");
  registry.close();
  const raw = new DatabaseSync(path);
  const rows = raw.prepare("SELECT * FROM tenants").all() as Array<Record<string, string>>;
  raw.close();
  assert.ok(!JSON.stringify(rows).includes(token));
  assert.match(rows[0]!["token_hash"]!, /^[0-9a-f]{64}$/);
  assert.ok(!readFileSync(path).includes(token), "nor is it anywhere in the file");
});

test("a token identifies an active rider and nobody else", () => {
  const registry = new Registry(":memory:");
  const { tenant, token } = registry.add("a@example.org");
  assert.equal(registry.verify(token)?.id, tenant.id);
  assert.equal(registry.verify(token + "x"), null);
  assert.equal(registry.verify(""), null);
  assert.equal(registry.verify("not-a-token"), null);
  assert.equal(registry.verify(newToken()), null);
  registry.setStatus("a@example.org", "suspended");
  assert.equal(registry.verify(token), null, "a suspended rider is let in by nobody");
  registry.setStatus(tenant.id, "active");
  assert.equal(registry.verify(token)?.id, tenant.id);
  assert.ok(registry.find(tenant.id)?.lastSeenAt, "last seen is noted");
});

test("a new token ends the old one at once, and a removed rider's token no longer works", () => {
  const registry = new Registry(":memory:");
  const { tenant, token } = registry.add("k@example.org");
  const fresh = registry.rekey("k@example.org");
  assert.equal(registry.verify(token), null);
  assert.equal(registry.verify(fresh.token)?.id, tenant.id);
  registry.remove(tenant.id);
  assert.equal(registry.verify(fresh.token), null);
  assert.equal(registry.find(tenant.id), null);
  assert.throws(() => registry.remove("nobody@example.org"), /No tenant matches/);
  assert.throws(() => registry.setStatus("nobody", "suspended"), /No tenant matches/);
});

test("an identifier that could make a path out of its folder is refused", () => {
  for (const bad of ["", "short", "../../etc/passwd", "a/b/c/d/e/f/g/h", "x".repeat(41), "has space123", "ünïcödé123"])
    assert.throws(() => assertTenantId(bad), /not a tenant identifier/, bad);
  assert.equal(assertTenantId("abc_DEF-1234"), "abc_DEF-1234");
  assert.ok(tenantDbPath("abc_DEF-1234").startsWith(join(dir, "tenants")));
  assert.throws(() => tenantDbPath("../x"), /not a tenant identifier/);
});

test("each rider has a library of their own, and RIDE_TENANT chooses it from the terminal", () => {
  const registry = new Registry(":memory:");
  const a = registry.add("lib-a@example.org").tenant;
  const b = registry.add("lib-b@example.org").tenant;
  const storeA = new Store(tenantDbPath(a.id));
  const storeB = new Store(tenantDbPath(b.id));
  storeA.saveRide(ride("Alice's loop"));
  storeB.saveRide(ride("Bob's loop"));
  assert.deepEqual(
    storeA.listRides().map((r) => r.name),
    ["Alice's loop"],
  );
  assert.deepEqual(
    storeB.listRides().map((r) => r.name),
    ["Bob's loop"],
  );
  assert.notEqual(tenantDbPath(a.id), tenantDbPath(b.id));
  assert.ok(librarySize(a.id) > 0);
  storeA.close?.();
  process.env.RIDE_TENANT = b.id;
  try {
    assert.deepEqual(
      new Store().listRides().map((r) => r.name),
      ["Bob's loop"],
    );
    process.env.RIDE_TENANT = "../nope";
    assert.throws(() => new Store(), /not a tenant identifier/);
  } finally {
    delete process.env.RIDE_TENANT;
  }
});

test("a removed rider's library is put aside, or deleted on purpose", () => {
  const registry = new Registry(":memory:");
  const keep = registry.add("keep@example.org").tenant;
  const purge = registry.add("purge@example.org").tenant;
  new Store(tenantDbPath(keep.id)).saveRide(ride("Keep me"));
  new Store(tenantDbPath(purge.id)).saveRide(ride("Purge me"));
  const aside = removeLibrary(keep.id, false, new Date("2026-10-19T10:00:00Z"));
  assert.ok(aside && aside.endsWith(`${keep.id}-2026-10-19`));
  assert.ok(existsSync(join(aside, "agentmotoride.db")));
  assert.equal(existsSync(tenantDbPath(keep.id)), false);
  assert.equal(removeLibrary(purge.id, true), null);
  assert.equal(existsSync(tenantDbPath(purge.id)), false);
  assert.equal(removeLibrary("neverused12345", false), null, "a rider who never used it has no library");
});

test("a backup is a consistent copy of the registry and of every library", () => {
  const registry = new Registry(join(dir, "backup-registry.db"));
  const t = registry.add("backup@example.org").tenant;
  new Store(tenantDbPath(t.id)).saveRide(ride("Backed up"));
  const { folder, copied } = backupAll(registry, join(dir, "backups"), new Date("2026-10-19T10:00:00Z"));
  assert.match(folder, /2026-10-19T10-00-00$/);
  assert.ok(copied.includes("registry.db") && copied.includes(`tenants/${t.id}`));
  const copy = new Store(join(folder, "tenants", t.id, "agentmotoride.db"));
  assert.deepEqual(
    copy.listRides().map((r) => r.name),
    ["Backed up"],
  );
  assert.equal(new Registry(join(folder, "registry.db")).find("backup@example.org")?.id, t.id);
  assert.ok(readdirSync(join(dir, "backups")).length >= 1);
});

test("the admin commands add, list, suspend, resume, rekey and remove, and say what is wrong", async () => {
  const registry = new Registry(":memory:");
  const said: string[] = [];
  const out = (s: string) => said.push(s);
  process.env.RIDE_SERVER_URL = "https://rides.example.org/";
  await run(["add", "Admin@Example.org"], registry, out);
  const text = said.at(-1)!;
  const token = /mrt_[A-Za-z0-9_-]+/.exec(text)![0];
  assert.match(
    text,
    /claude mcp add --transport http ride https:\/\/rides\.example\.org\/mcp --header "Authorization: Bearer mrt_/,
  );
  assert.match(text, /\[mcp_servers\.ride\]/);
  assert.equal(registry.verify(token)?.email, "admin@example.org");

  await run(["list"], registry, out);
  assert.match(said.at(-1)!, /admin@example\.org\s+active/);
  assert.equal(listText(new Registry(":memory:")), "No riders yet. Add one: npm run admin -- add <email>");
  await run(["list", "--json"], registry, out);
  assert.equal(JSON.parse(said.at(-1)!)[0].email, "admin@example.org");
  assert.ok(!said.at(-1)!.includes(token), "the token is never listed");

  await run(["suspend", "admin@example.org"], registry, out);
  assert.match(said.at(-1)!, /is suspended/);
  assert.equal(registry.verify(token), null);
  await run(["resume", "admin@example.org"], registry, out);
  await run(["token", "admin@example.org"], registry, out);
  assert.equal(registry.verify(token), null);
  assert.match(said.at(-1)!, /old one no longer works/);

  await assert.rejects(run(["add", "admin@example.org"], registry, out), /already registered/);
  await assert.rejects(run(["suspend"], registry, out), /Which rider/);
  await assert.rejects(run(["remove", "ghost@example.org", "--yes"], registry, out), /No tenant matches/);
  await assert.rejects(run(["frobnicate"], registry, out), /Unknown command/);
  await assert.rejects(run(["remove", "admin@example.org"], registry, out), /add --yes|Not done/);
  assert.equal(registry.find("admin@example.org")?.status, "active", "nothing was removed without a yes");
  await run(["remove", "admin@example.org", "--yes"], registry, out);
  assert.match(said.at(-1)!, /admin@example\.org removed/);
  assert.equal(registry.find("admin@example.org"), null);
  await run(["help"], registry, out);
  assert.match(said.at(-1)!, /Usage: npm run admin/);
  assert.match(
    connectionText(
      { id: "x", email: "e@x.org", status: "active", createdAt: "", lastSeenAt: null },
      "mrt_t",
      "https://h/",
    ),
    /https:\/\/h\/mcp/,
  );
});
