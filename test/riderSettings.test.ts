import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_PREFERENCES, effectivePreferences } from "../src/preferences.ts";
import { createRideServer } from "../src/rideServer.ts";
import { Store } from "../src/store.ts";

const library = () => join(mkdtempSync(join(tmpdir(), "ride-settings-")), "rides.db");

test("preferences: what the rider saved wins over the environment, which wins over the defaults", () => {
  assert.deepEqual(effectivePreferences({}, {}), DEFAULT_PREFERENCES);
  const env = { RIDE_MAX_30_PCT: "9", RIDE_MAX_50_PCT: "40", RIDE_ALLOW_MOTORWAYS: "1" };
  const fromEnv = effectivePreferences({}, env);
  assert.deepEqual([fromEnv.max30Pct, fromEnv.max50Pct, fromEnv.avoidMotorways], [9, 40, false]);
  const saved = effectivePreferences({ max30Pct: 1, avoidMotorways: true, home: "Lille" }, env);
  assert.deepEqual(
    [saved.max30Pct, saved.max50Pct, saved.avoidMotorways],
    [1, 40, true],
    "only what was saved changes",
  );
  assert.ok(!("home" in saved), "home is not a preference");
});

test("library: settings are kept per key, replaced one by one, forgotten on request, and bad values are ignored", () => {
  const path = library();
  const store = new Store(path);
  assert.deepEqual(store.getSettings(), {});
  store.setSettings({ home: "Lille", max30Pct: 5 });
  store.setSettings({ max30Pct: 2, avoidMotorways: false, max50Pct: undefined });
  assert.deepEqual(store.getSettings(), { home: "Lille", max30Pct: 2, avoidMotorways: false });
  store.database.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('max50Pct', 'not json')").run();
  store.database.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('shoeSize', '42')").run();
  assert.deepEqual(
    store.getSettings(),
    { home: "Lille", max30Pct: 2, avoidMotorways: false },
    "unreadable and unknown keys are ignored",
  );
  store.close();
  const again = new Store(path);
  assert.equal(again.getSettings().home, "Lille", "kept in the file");
  again.clearSettings();
  assert.deepEqual(again.getSettings(), {});
  again.close();
});

async function session(path: string) {
  const store = new Store(path);
  const ride = createRideServer(store, { home: "" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([ride.server.connect(a), client.connect(b)]);
  return {
    ride,
    store,
    call: (args: Record<string, unknown>) => client.callTool({ name: "rideSettings", arguments: args }),
    close: async () => {
      await client.close();
      store.close();
    },
  };
}

test("rideSettings keeps what the rider sets for the next session, and reset forgets it", async () => {
  const path = library();
  const first = await session(path);
  try {
    assert.equal(first.ride.context.preferences.max30Pct, DEFAULT_PREFERENCES.max30Pct);
    await first.call({ home: "50.63,3.06", allowMotorways: true, max30Pct: 7, maxStraightPct: 30 });
    assert.deepEqual(first.store.getSettings(), {
      home: "50.63,3.06",
      avoidMotorways: false,
      max30Pct: 7,
      maxStraightPct: 30,
    });
  } finally {
    await first.close();
  }

  // The next session starts from what was saved, start point included, with no call.
  const second = await session(path);
  try {
    const p = second.ride.context.preferences;
    assert.deepEqual(
      [p.avoidMotorways, p.max30Pct, p.maxStraightPct, p.max50Pct],
      [false, 7, 30, DEFAULT_PREFERENCES.max50Pct],
    );
    assert.equal(second.ride.context.home.label, "", "no start point until it is restored");
    assert.equal(await second.ride.restoreHome(), true);
    assert.equal(second.ride.context.home.label, "50.63,3.06");

    await second.call({ reset: true });
    assert.deepEqual(second.store.getSettings(), {});
    assert.equal(second.ride.context.preferences.max30Pct, DEFAULT_PREFERENCES.max30Pct);
  } finally {
    await second.close();
  }
  const third = await session(path);
  try {
    assert.equal(await third.ride.restoreHome(), false, "nothing saved, nothing restored");
    assert.equal(third.ride.context.preferences.avoidMotorways, true);
  } finally {
    await third.close();
  }
});

test("a saved start point that cannot be resolved is not an error: the rider gives it again", async () => {
  const path = library();
  const store = new Store(path);
  store.setSettings({ home: "95,200" });
  store.close();
  const s = await session(path);
  try {
    assert.equal(await s.ride.restoreHome(), false);
  } finally {
    await s.close();
  }
});
