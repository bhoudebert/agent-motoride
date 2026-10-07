import assert from "node:assert/strict";
import { test } from "node:test";
import { describePreferences } from "../src/agent.ts";
import { DEFAULT_MAX_FAST_PCT, DEFAULT_PREFERENCES, preferencesFromEnv } from "../src/preferences.ts";

test("fast expressway ceiling: 25% unless set, from the environment too", () => {
  assert.equal(DEFAULT_MAX_FAST_PCT, 25);
  assert.equal(preferencesFromEnv({}).maxFastPct, 25);
  assert.equal(preferencesFromEnv({ RIDE_MAX_FAST_PCT: "40" }).maxFastPct, 40);
  assert.equal(preferencesFromEnv({ RIDE_MAX_FAST_PCT: "140" }).maxFastPct, 25, "out of range: the default");
});

test("fast expressway ceiling: the planner is told it only when the rider changed it", () => {
  assert.doesNotMatch(
    describePreferences(DEFAULT_PREFERENCES),
    /Fast expressways/,
    "the default text stays as recorded",
  );
  assert.match(
    describePreferences({ ...DEFAULT_PREFERENCES, maxFastPct: 40 }),
    /\n- Fast expressways \(not motorways, 100 km\/h or more\): at most 40% of the distance\.$/,
  );
  assert.match(
    describePreferences({ ...DEFAULT_PREFERENCES, maxFastPct: 100 }),
    /at most 100% of the distance \(no ceiling\)\./,
  );
  assert.doesNotMatch(
    describePreferences({ ...DEFAULT_PREFERENCES, avoidMotorways: false, maxFastPct: 40 }),
    /Fast expressways/,
    "motorways permitted: a practical trip, no ceiling to state",
  );
});
