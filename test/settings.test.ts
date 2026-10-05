import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PREFERENCES, preferencesFromEnv } from "../src/preferences.ts";
import { DEFAULT_PROFILE, describeProfile, parseProfileArgs } from "../src/profile.ts";

test("bike profile: key=value and --key value forms", () => {
  assert.deepEqual(parseProfileArgs(["range=300", "reserve=30"]), { tankRangeKm: 300, reserveKm: 30 });
  assert.deepEqual(parseProfileArgs(["--pause", "60", "lunch=no"]), { pauseEveryMin: 60, lunch: false });
  assert.deepEqual(parseProfileArgs(["stint=120", "lunch=yes"]), { maxStintMin: 120, lunch: true });
});

test("bike profile: bad input is rejected with a useful message", () => {
  assert.throws(() => parseProfileArgs(["range=-5"]), /positive number/);
  assert.throws(() => parseProfileArgs(["speed=90"]), /Known: range/);
  assert.throws(() => parseProfileArgs(["300"]), /range=250/);
});

test("bike profile: description states the fuel deadline", () => {
  assert.match(describeProfile(DEFAULT_PROFILE), /tank range 250 km, fuel by 210 km/);
});

test("preferences from the environment, with defaults and validation", () => {
  assert.deepEqual(preferencesFromEnv({}), DEFAULT_PREFERENCES);
  const p = preferencesFromEnv({ RIDE_ALLOW_MOTORWAYS: "1", RIDE_MAX_30_PCT: "5", RIDE_MAX_50_PCT: "abc" });
  assert.equal(p.avoidMotorways, false);
  assert.equal(p.max30Pct, 5);
  assert.equal(p.max50Pct, DEFAULT_PREFERENCES.max50Pct, "invalid value falls back to the default");
  assert.equal(preferencesFromEnv({ RIDE_MAX_30_PCT: "150" }).max30Pct, DEFAULT_PREFERENCES.max30Pct);
});
