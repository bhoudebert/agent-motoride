import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveShares, MAX_CT_CHARS } from "../src/live.ts";

const CH = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 characters
const CH2 = "BBBBBBBBBBBBBBBBBBBBBB";
const IV = "AAAAAAAAAAAAAAAA"; // 16 characters: a 96-bit nonce
const CT = "A".repeat(40);

const make = (options = {}) => {
  let clock = 1_000_000;
  const live = new LiveShares({ now: () => clock, ...options });
  return { live, tick: (ms: number) => (clock += ms) };
};

test("a channel is created once by its rider, and is theirs", () => {
  const { live } = make();
  assert.equal(live.create(CH, "alice"), "created");
  assert.equal(live.create(CH, "alice"), "same");
  assert.equal(live.create(CH, "bob"), "taken");
  for (const bad of ["", "short", "A".repeat(21), "A".repeat(23), "A".repeat(21) + "!", "../../etc/passwd/xxxxxx"])
    assert.equal(live.create(bad, "alice"), "bad", bad);
  assert.equal(live.size, 1);
});

test("a rider has 3 channels open, the server a limit in all", () => {
  const { live } = make({ total: 4 });
  const ids = ["a", "b", "c", "d", "e"].map((c) => c.repeat(22));
  assert.deepEqual(
    ids.slice(0, 4).map((id) => live.create(id, "alice")),
    ["created", "created", "created", "limit"],
  );
  assert.equal(live.create(ids[3]!, "bob"), "created");
  assert.equal(live.create(ids[4]!, "carol"), "limit", "the server is full");
});

test("an update is stored with a sequence number, and only its rider may publish", () => {
  const { live, tick } = make();
  live.create(CH, "alice");
  assert.deepEqual(live.publish(CH, "alice", IV, CT), { ok: true, seq: 1 });
  tick(2000);
  assert.deepEqual(live.publish(CH, "alice", IV, CT), { ok: true, seq: 2 });
  assert.deepEqual(live.publish(CH, "bob", IV, CT), { ok: false, reason: "forbidden" });
  assert.deepEqual(live.publish(CH2, "alice", IV, CT), { ok: false, reason: "unknown" });
  const read = live.read(CH, 0)!;
  assert.equal(read.state, "live");
  assert.deepEqual(
    read.items.map((u) => u.seq),
    [1, 2],
  );
  assert.equal(read.next, 2);
  assert.deepEqual(
    live.read(CH, 1)!.items.map((u) => u.seq),
    [2],
    "only what is new",
  );
  assert.deepEqual(live.read(CH, 2)!.items, []);
  assert.equal(live.read(CH2, 0), null);
});

test("an update is checked for its shape and size, never its content", () => {
  const { live, tick } = make();
  live.create(CH, "alice");
  const bad = (iv: unknown, ct: unknown) => live.publish(CH, "alice", iv, ct);
  for (const [iv, ct] of [
    ["short", CT],
    [IV, "short"],
    [IV, "not base64url!!" + "A".repeat(30)],
    [IV, "A".repeat(MAX_CT_CHARS + 1)],
    [123, CT],
    [IV, null],
    [IV + "A", CT],
  ] as Array<[unknown, unknown]>)
    assert.deepEqual(bad(iv, ct), { ok: false, reason: "bad" }, `${String(iv)} ${String(ct).slice(0, 10)}`);
  assert.equal(bad(IV, "A".repeat(MAX_CT_CHARS)).ok, true, "the largest allowed");
  tick(2000);
  assert.equal(live.publish(CH, "alice", IV, CT).ok, true);
});

test("a channel takes at most one update every 2 seconds", () => {
  const { live, tick } = make();
  live.create(CH, "alice");
  assert.equal(live.publish(CH, "alice", IV, CT).ok, true);
  tick(1000);
  assert.deepEqual(live.publish(CH, "alice", IV, CT), { ok: false, reason: "too-fast" });
  tick(1000);
  assert.equal(live.publish(CH, "alice", IV, CT).ok, true);
});

test("only the last updates are kept, the sequence goes on", () => {
  const { live, tick } = make({ keep: 3 });
  live.create(CH, "alice");
  for (let i = 0; i < 5; i++) {
    live.publish(CH, "alice", IV, CT);
    tick(2000);
  }
  const read = live.read(CH, 0)!;
  assert.deepEqual(
    read.items.map((u) => u.seq),
    [3, 4, 5],
  );
  assert.equal(read.next, 5);
});

test("a ride that ends is kept 30 minutes for followers, takes no more updates; stopping removes it at once", () => {
  const { live, tick } = make();
  live.create(CH, "alice");
  live.create(CH2, "alice");
  live.publish(CH, "alice", IV, CT);
  assert.equal(live.end(CH, "bob", "end"), "forbidden");
  assert.equal(live.end(CH, "alice", "end"), "ok");
  assert.equal(live.read(CH, 0)!.state, "ended");
  tick(2000);
  assert.deepEqual(live.publish(CH, "alice", IV, CT), { ok: false, reason: "ended" });
  tick(29 * 60_000);
  assert.equal(live.read(CH, 0)!.items.length, 1, "still there");
  tick(2 * 60_000);
  assert.equal(live.read(CH, 0), null, "gone after 30 minutes");
  assert.equal(live.end(CH2, "alice", "stop"), "ok");
  assert.equal(live.read(CH2, 0), null);
  assert.equal(live.end(CH2, "alice", "stop"), "unknown");
});

test("an idle channel is removed after 12 hours, and a sweep says how many", () => {
  const { live, tick } = make();
  live.create(CH, "alice");
  live.create(CH2, "bob");
  tick(11 * 3_600_000);
  live.publish(CH2, "bob", IV, CT);
  tick(2 * 3_600_000);
  assert.equal(live.sweep(), 1);
  assert.equal(live.read(CH, 0), null);
  assert.notEqual(live.read(CH2, 0), null);
});

test("a rider's channels go when the rider does", () => {
  const { live } = make();
  live.create(CH, "alice");
  live.create(CH2, "bob");
  assert.equal(live.dropTenant("alice"), 1);
  assert.equal(live.read(CH, 0), null);
  assert.notEqual(live.read(CH2, 0), null);
});
