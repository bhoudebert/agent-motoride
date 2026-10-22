import assert from "node:assert/strict";
import { randomBytes, webcrypto } from "node:crypto";
import { test } from "node:test";
// The page's own script, run here: it touches the document only when there is a map to draw.
import { ago, decryptUpdate, importKey, summarise } from "../assets/follow/follow.js";

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const CHANNEL = b64url(randomBytes(16));

/** What the phone does: AES-256-GCM, a fresh nonce, the channel as associated data. */
async function encrypt(keyB64: string, channel: string, point: Record<string, unknown>) {
  const key = await webcrypto.subtle.importKey("raw", Buffer.from(keyB64, "base64url"), "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(12);
  const ct = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(channel) },
    key,
    new TextEncoder().encode(JSON.stringify(point)),
  );
  return { iv: b64url(iv), ct: b64url(new Uint8Array(ct)) };
}

const KEY = b64url(randomBytes(32));
const point = { v: 1, n: 1, t: 1000, lat: 50.45, lon: 3.2, spd: 54, hdg: 90, acc: 6, state: "riding", name: "To Mons" };

test("the follower's page reads what the phone encrypted, and gives its place and time", async () => {
  const key = (await importKey(KEY))!;
  const sealed = await encrypt(KEY, CHANNEL, point);
  const read = (await decryptUpdate(key, CHANNEL, { seq: 7, at: 5000, ...sealed }))!;
  assert.equal(read.lat, 50.45);
  assert.equal(read.lon, 3.2);
  assert.equal(read.name, "To Mons");
  assert.equal(read.seq, 7);
  assert.equal(read.at, 5000);
});

test("a wrong key, another channel or a tampered update is nothing, never a wrong place", async () => {
  const key = (await importKey(KEY))!;
  const other = (await importKey(b64url(randomBytes(32))))!;
  const sealed = await encrypt(KEY, CHANNEL, point);
  assert.equal(await decryptUpdate(other, CHANNEL, { seq: 1, at: 1, ...sealed }), null, "another key");
  assert.equal(
    await decryptUpdate(key, b64url(randomBytes(16)), { seq: 1, at: 1, ...sealed }),
    null,
    "another channel",
  );
  const flipped = Buffer.from(sealed.ct, "base64url");
  flipped[3] = flipped[3]! ^ 1;
  assert.equal(
    await decryptUpdate(key, CHANNEL, { seq: 1, at: 1, iv: sealed.iv, ct: b64url(flipped) }),
    null,
    "tampered",
  );
  assert.equal(await decryptUpdate(key, CHANNEL, { seq: 1, at: 1, iv: "x", ct: "y" }), null, "garbage");
  for (const bad of [{ ...point, v: 2 }, { ...point, lat: 91 }, { ...point, lon: "3" }, { v: 1 }]) {
    const s = await encrypt(KEY, CHANNEL, bad);
    assert.equal(await decryptUpdate(key, CHANNEL, { seq: 1, at: 1, ...s }), null, JSON.stringify(bad));
  }
});

test("a key that is not a 256-bit key is refused before anything is decrypted", async () => {
  for (const bad of ["", "short", "A".repeat(42), "A".repeat(44), "!".repeat(43)])
    assert.equal(await importKey(bad), null, bad);
});

test("what the page says: waiting, riding, stopped, no news, ended", () => {
  const now = 100_000;
  const at = (ms: number, state = "riding") => ({ at: now - ms, state });
  assert.equal(summarise([], "live", now).headline, "Waiting for the first position…");
  assert.equal(summarise([], "ended", now).headline, "This ride has ended.");
  assert.deepEqual(summarise([at(12_000)], "live", now), { headline: "Riding", ageS: 12, stale: false });
  assert.equal(summarise([at(5000, "stopped")], "live", now).headline, "Stopped");
  assert.deepEqual(summarise([at(3 * 60_000)], "live", now), {
    headline: "No news for a while",
    ageS: 180,
    stale: true,
  });
  assert.equal(summarise([at(5000)], "ended", now).headline, "Ride ended");
  assert.equal(summarise([at(5000, "ended")], "live", now).headline, "Ride ended");
});

test("a possible crash is said first, at any age, until the rider says they are fine", () => {
  const now = 1_000_000;
  const at = (ms: number, state: string) => ({ at: now - ms, state });
  assert.deepEqual(summarise([at(5000, "riding"), at(2000, "alert")], "live", now), {
    headline: "Possible crash",
    ageS: 2,
    stale: false,
    alert: true,
  });
  // Even when the phone has gone quiet (it may be broken, or have no signal): that is no reason to take the alert back.
  assert.equal(summarise([at(10 * 60_000, "alert")], "live", now).headline, "Possible crash");
  assert.equal(summarise([at(10 * 60_000, "alert")], "live", now).alert, true);
  // The rider says all is well: the next update is a riding one.
  assert.equal(summarise([at(30_000, "alert"), at(1000, "riding")], "live", now).headline, "Riding");
  assert.equal("alert" in summarise([at(30_000, "alert"), at(1000, "riding")], "live", now), false);
  // An ended ride is an ended ride.
  assert.equal(summarise([at(5000, "alert")], "ended", now).headline, "Ride ended");
});

test("times are said short", () => {
  assert.equal(ago(null), "");
  assert.equal(ago(12), "12 s ago");
  assert.equal(ago(180), "3 min ago");
  assert.equal(ago(7500), "2 h 05 ago");
});
