import assert from "node:assert/strict";
import { test } from "node:test";
import { levelOf, TrafficFlow, type TrafficProvider } from "../src/traffic.ts";

const answer = (currentSpeed: number, freeFlowSpeed: number, extra: Record<string, unknown> = {}) => ({
  flowSegmentData: { currentSpeed, freeFlowSpeed, confidence: 0.9, roadClosure: false, ...extra },
});

test("the speed against an empty road gives free, slow, heavy or closed", () => {
  assert.equal(levelOf(1, false), "free");
  assert.equal(levelOf(0.8, false), "free");
  assert.equal(levelOf(0.79, false), "slow");
  assert.equal(levelOf(0.5, false), "slow");
  assert.equal(levelOf(0.49, false), "heavy");
  assert.equal(levelOf(0.9, true), "closed");
  assert.equal(levelOf(null, false), "unknown");
});

test("a server offers no traffic unless TomTom was asked for, with a key", () => {
  assert.equal(new TrafficFlow({ key: "K", provider: "off" }).available, false);
  assert.equal(new TrafficFlow({ key: "K", provider: "open-data" }).available, true); // no key needed
  assert.equal(new TrafficFlow({ key: "", provider: "tomtom-flow" }).available, false);
  assert.equal(new TrafficFlow({ key: "K", provider: "tomtom-flow" }).available, true);
});

test("each point is asked of TomTom with the host's key, rounded to a hundredth of a degree, and read as a level", async () => {
  const urls: string[] = [];
  const flow = new TrafficFlow({
    key: "K",
    provider: "tomtom-flow",
    fetch: async (url) => {
      urls.push(url);
      return answer(20, 50);
    },
  });
  const r = await flow.flow([[50.12345, 3.98765]]);
  assert.equal(r.points[0]!.level, "heavy");
  assert.equal(r.points[0]!.ratio, 0.4);
  const u = new URL(urls[0]!);
  assert.equal(u.searchParams.get("key"), "K");
  assert.equal(u.searchParams.get("point"), "50.12,3.99");
});

test("a low confidence, a failure or a closed road is said as it is, and one failure does not spoil the others", async () => {
  const flow = new TrafficFlow({
    key: "K",
    provider: "tomtom-flow",
    fetch: async (url) => {
      const p = new URL(url).searchParams.get("point");
      if (p === "50.1,3.1") return answer(10, 50, { confidence: 0.2 });
      if (p === "50.2,3.2") throw new Error("down");
      if (p === "50.3,3.3") return answer(0, 50, { roadClosure: true });
      return answer(45, 50);
    },
  });
  const r = await flow.flow([
    [50.1, 3.1],
    [50.2, 3.2],
    [50.3, 3.3],
    [50.4, 3.4],
  ]);
  assert.deepEqual(
    r.points.map((p) => p.level),
    ["unknown", "unknown", "closed", "free"],
  );
});

test("TomTom is asked again for every request: its terms forbid keeping results to serve several riders", async () => {
  let asked = 0;
  const flow = new TrafficFlow({
    key: "K",
    provider: "tomtom-flow",
    fetch: async () => {
      asked++;
      return answer(50, 50);
    },
  });
  await flow.flow([[50, 3]]);
  await flow.flow([[50.001, 3.001]]); // the same cell, another rider
  assert.equal(asked, 2);
});

test("a provider that allows it is asked once in its cache time for everyone, and again after", async () => {
  let t = 0;
  let asked = 0;
  const open: TrafficProvider = {
    name: "open",
    cacheMs: 60_000,
    metered: false,
    async flowAt() {
      asked++;
      return { level: "free", ratio: 1 };
    },
  };
  const flow = new TrafficFlow({ custom: open, now: () => t });
  await flow.flow([[50, 3]]);
  await flow.flow([[50.001, 3.001]]);
  assert.equal(asked, 1);
  t += 60_000;
  await flow.flow([[50, 3]]);
  assert.equal(asked, 2);
});

test("a provider that costs nothing per place is not held to the daily cap", async () => {
  const open: TrafficProvider = {
    name: "open",
    cacheMs: 0,
    metered: false,
    flowAt: async () => ({ level: "free", ratio: 1 }),
  };
  const flow = new TrafficFlow({ custom: open, perDay: 1 });
  const r = await flow.flow([
    [50, 3],
    [51, 3],
  ]);
  assert.equal(r.budget, true);
});

test("the daily budget stops the asking, says so, and starts again the next day", async () => {
  let t = Date.parse("2026-10-22T10:00:00Z");
  let asked = 0;
  const flow = new TrafficFlow({
    key: "K",
    provider: "tomtom-flow",
    perDay: 2,
    now: () => t,
    fetch: async () => {
      asked++;
      return answer(50, 50);
    },
  });
  const r = await flow.flow([
    [50, 3],
    [51, 3],
    [52, 3],
  ]);
  assert.equal(asked, 2);
  assert.equal(r.budget, false);
  assert.equal(r.points[2]!.level, "unknown");
  t = Date.parse("2026-10-23T00:00:01Z");
  const next = await flow.flow([[53, 3]]);
  assert.equal(next.budget, true);
  assert.equal(asked, 3);
});

test("the provider is chosen by name, and a name that is not one is a mistake said at once", () => {
  assert.equal(new TrafficFlow({ key: "K", provider: "tomtom-flow" }).available, true);
  assert.equal(new TrafficFlow({ key: "", provider: "tomtom-flow" }).available, false);
  assert.throws(
    () => new TrafficFlow({ key: "K", provider: "nope" }),
    /Unknown TRAFFIC_PROVIDER "nope"\. Known: open-data, off, tomtom-flow\./,
  );
});

test("TRAFFIC_PROVIDER from the environment picks the provider", () => {
  const before = process.env.TRAFFIC_PROVIDER;
  process.env.TRAFFIC_PROVIDER = "nope";
  try {
    assert.throws(() => new TrafficFlow({ key: "K" }), /Unknown TRAFFIC_PROVIDER/);
  } finally {
    if (before === undefined) delete process.env.TRAFFIC_PROVIDER;
    else process.env.TRAFFIC_PROVIDER = before;
  }
});
