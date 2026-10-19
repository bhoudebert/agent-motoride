import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The data folder is read when the modules load: point it at a scratch folder first.
const dir = mkdtempSync(join(tmpdir(), "ride-invite-"));
process.env.RIDE_DATA_DIR = dir;
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { inviteLink, run } = await import("../src/admin.ts");

const HOUR = 3_600_000;

test("an invitation is a code kept as a hash, valid once, and the token it gives is the phone's own", () => {
  const registry = new Registry(":memory:");
  const { tenant: rider, token: mcpToken } = registry.add("alice@example.org");
  const invite = registry.invite("alice@example.org");
  assert.match(invite.code, /^mri_[A-Za-z0-9_-]{32}$/);
  assert.equal(invite.created, false);
  assert.equal(invite.pin, null);
  const got = registry.redeem(invite.code);
  assert.ok(got.ok);
  assert.match(got.token, /^mrt_/);
  assert.equal(registry.verify(got.token)?.id, rider.id);
  // The phone's token is another one: the rider's token for Claude Code goes on working.
  assert.notEqual(got.token, mcpToken);
  assert.equal(registry.verify(mcpToken)?.id, rider.id);
  // Used: the same code is of no use any more, and says no more than "invalid".
  assert.deepEqual(registry.redeem(invite.code), { ok: false, reason: "invalid" });
  registry.close();
});

test("an unknown, expired or malformed code is invalid, and an unregistered email is registered by its invitation", () => {
  const registry = new Registry(":memory:");
  const t0 = Date.now();
  const invite = registry.invite("new@example.org", { hours: 1, now: t0 });
  assert.equal(invite.created, true);
  assert.equal(registry.find("new@example.org")?.status, "active");
  assert.deepEqual(registry.redeem("mri_" + "x".repeat(32)), { ok: false, reason: "invalid" });
  assert.deepEqual(registry.redeem("nonsense"), { ok: false, reason: "invalid" });
  assert.deepEqual(registry.redeem(invite.code, undefined, t0 + 2 * HOUR), { ok: false, reason: "invalid" });
  assert.ok(registry.redeem(invite.code, undefined, t0 + HOUR / 2).ok);
  assert.throws(() => registry.invite("new@example.org", { hours: 0 }), /between 1 and 720/);
  assert.throws(() => registry.invite("not an email"), /not an email/);
  registry.close();
});

test("a PIN is six digits the server checks: a missing one costs nothing, a wrong one counts, the third burns the invitation", () => {
  const registry = new Registry(":memory:");
  const invite = registry.invite("bob@example.org", { pin: true });
  assert.match(invite.pin!, /^\d{6}$/);
  assert.deepEqual(registry.redeem(invite.code), { ok: false, reason: "pin", triesLeft: 3 });
  const wrong = invite.pin === "000000" ? "111111" : "000000";
  assert.deepEqual(registry.redeem(invite.code, wrong), { ok: false, reason: "pin", triesLeft: 2 });
  assert.deepEqual(registry.redeem(invite.code, "12"), { ok: false, reason: "pin", triesLeft: 1 });
  assert.deepEqual(registry.redeem(invite.code, wrong), { ok: false, reason: "locked" });
  // Burnt: even the right PIN does not open it now.
  assert.deepEqual(registry.redeem(invite.code, invite.pin!), { ok: false, reason: "locked" });
  const again = registry.invite("bob@example.org", { pin: true });
  assert.ok(registry.redeem(again.code, again.pin!).ok);
  registry.close();
});

test("a phone's token stops with the rider: suspended, revoked or removed", () => {
  const registry = new Registry(":memory:");
  const first = registry.invite("carol@example.org");
  const phone = registry.redeem(first.code);
  assert.ok(phone.ok);
  registry.setStatus("carol@example.org", "suspended");
  assert.equal(registry.verify(phone.token), null);
  registry.setStatus("carol@example.org", "active");
  assert.ok(registry.verify(phone.token));
  const pending = registry.invite("carol@example.org");
  assert.equal(registry.revokeDevices("carol@example.org"), 1);
  assert.equal(registry.verify(phone.token), null);
  assert.deepEqual(registry.redeem(pending.code), { ok: false, reason: "invalid" });
  const second = registry.redeem(registry.invite("carol@example.org").code);
  assert.ok(second.ok);
  registry.remove("carol@example.org");
  assert.equal(registry.verify(second.token), null);
  registry.close();
});

test("npm run admin -- invite prints a QR code, the link, the PIN and the expiry, and can save the QR as a file", async () => {
  const registry = new Registry(":memory:");
  const lines: string[] = [];
  const out = (s: string) => lines.push(s);
  await assert.rejects(run(["invite", "dave@example.org"], registry, out), /RIDE_SERVER_URL|--url/);
  await assert.rejects(run(["invite", "dave@example.org", "--url=http://rides.example.org"], registry, out), /https/);
  const png = join(dir, "dave.png");
  const svg = join(dir, "dave.svg");
  await run(
    ["invite", "dave@example.org", "--pin", "--hours=2", "--url=https://rides.example.org/", `--out=${png}`],
    registry,
    out,
  );
  await run(["invite", "erin@example.org", `--url=http://localhost:18973`, `--out=${svg}`], registry, out);
  const text = lines.join("\n");
  assert.match(text, /Invitation for dave@example.org \(registered just now\)/);
  assert.match(text, /mobilemotoride:\/\/server\?url=https%3A%2F%2Frides\.example\.org&code=mri_/);
  assert.match(text, /PIN: \d{6}/);
  assert.match(text, /No PIN: whoever scans it first joins\./);
  assert.match(text, /[▀▄█]/);
  assert.equal(readFileSync(png).subarray(1, 4).toString(), "PNG");
  assert.match(readFileSync(svg, "utf8"), /^<svg/);
  await assert.rejects(
    run(["invite", "x@example.org", "--url=https://a.b", `--out=${join(dir, "x.txt")}`], registry, out),
    /\.png or a \.svg/,
  );
  await run(["devices", "dave@example.org", "--revoke"], registry, out);
  assert.match(lines.at(-1)!, /0 phone\(s\) stopped/);
  await assert.rejects(run(["devices", "dave@example.org"], registry, out), /--revoke/);
  assert.ok(existsSync(png));
  assert.equal(inviteLink("https://a.b/", "mri_c"), "mobilemotoride://server?url=https%3A%2F%2Fa.b&code=mri_c");
  registry.close();
});

test("the server exchanges a code for a token at /enrol, and the token opens the rider's tools and relay", async () => {
  const registry = new Registry(":memory:");
  const invite = registry.invite("fay@example.org", { pin: true });
  const server = createHttpServer({ registry });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  const enrol = (body: unknown) =>
    fetch(`${base}/enrol`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  try {
    assert.equal((await fetch(`${base}/enrol`)).status, 405);
    assert.equal((await enrol({})).status, 400);
    assert.equal((await enrol({ code: 3 })).status, 400);
    assert.equal((await enrol({ code: "mri_" + "z".repeat(32) })).status, 404);
    const noPin = await enrol({ code: invite.code });
    assert.equal(noPin.status, 403);
    assert.deepEqual(await noPin.json(), { error: "pin", triesLeft: 3 });
    const wrong = invite.pin === "000000" ? "111111" : "000000";
    assert.deepEqual(await (await enrol({ code: invite.code, pin: wrong })).json(), { error: "pin", triesLeft: 2 });
    const ok = await enrol({ code: invite.code, pin: invite.pin });
    assert.equal(ok.status, 200);
    const { token } = (await ok.json()) as { token: string };
    assert.match(token, /^mrt_/);
    // The token is a rider's: the relay takes it.
    const channel = "A".repeat(22);
    const made = await fetch(`${base}/share/${channel}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(made.status, 201);
    // And the code is spent.
    assert.equal((await enrol({ code: invite.code, pin: invite.pin })).status, 404);
  } finally {
    await server.close();
    registry.close();
  }
});

test("the server limits the tries at /enrol and refuses a body that is too large", async () => {
  const registry = new Registry(":memory:");
  const server = createHttpServer({ registry });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  const post = (body: string) => fetch(`${base}/enrol`, { method: "POST", body });
  try {
    assert.equal((await post("x".repeat(2000))).status, 413);
    assert.equal((await post("{not json")).status, 400);
    for (let i = 0; i < 29; i++) await post('{"code":"mri_' + "q".repeat(32) + '"}');
    assert.equal((await post('{"code":"mri_' + "q".repeat(32) + '"}')).status, 429);
  } finally {
    await server.close();
    registry.close();
  }
});
