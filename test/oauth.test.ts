import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { installFakeServices } from "./helpers/fakeServices.ts";

const dir = mkdtempSync(join(tmpdir(), "ride-oauth-"));
process.env.RIDE_DATA_DIR = dir;
const { Registry } = await import("../src/tenants.ts");
const { createHttpServer } = await import("../src/server.ts");
const { challengeOf } = await import("../src/oauth.ts");

installFakeServices();

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(60);

async function setup(oauth: boolean | { redirects: string[] } = true) {
  const registry = new Registry(":memory:");
  const alice = registry.add("alice@example.org");
  let clock = 1_000_000;
  const app = createHttpServer({
    registry,
    now: () => clock,
    oauth: oauth ? { baseUrl: "https://rides.example.org", ...(oauth === true ? {} : oauth) } : undefined,
  });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const register = async (redirect = CLAUDE, name = "Claude") => {
    const r = await fetch(`${url}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const authorizeQuery = (clientId: string, extra: Record<string, string> = {}) =>
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CLAUDE,
      code_challenge: challengeOf(VERIFIER),
      code_challenge_method: "S256",
      state: "xyz",
      ...extra,
    });
  const submit = (clientId: string, linkCode: string, extra: Record<string, string> = {}) =>
    fetch(`${url}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...Object.fromEntries(authorizeQuery(clientId, extra)),
        link_code: linkCode,
        decision: "allow",
      }),
    });
  const token = (params: Record<string, string>) =>
    fetch(`${url}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  /** Registers a client, signs in with a fresh code and exchanges the result for tokens. */
  const connectChat = async () => {
    const client = (await register()).body["client_id"] as string;
    const code = s.registry.linkCode(alice.tenant.id, clock).code;
    const back = await submit(client, code);
    const location = new URL(back.headers.get("location")!);
    const exchanged = await token({
      grant_type: "authorization_code",
      code: location.searchParams.get("code")!,
      client_id: client,
      redirect_uri: CLAUDE,
      code_verifier: VERIFIER,
    });
    return { client, exchanged, body: (await exchanged.json()) as Record<string, string> };
  };
  const s = {
    registry,
    alice,
    app,
    url,
    register,
    authorizeQuery,
    submit,
    token,
    connectChat,
    tick: (ms: number) => (clock += ms),
  };
  return s;
}

const mcpStatus = async (url: string, secret: string) =>
  (
    await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: "{}",
    })
  ).status;

test("sign-in for chat assistants is off unless asked for: nothing changes", async () => {
  const s = await setup(false);
  try {
    assert.equal((await fetch(`${s.url}/.well-known/oauth-authorization-server`)).status, 404);
    assert.equal((await fetch(`${s.url}/oauth/register`, { method: "POST" })).status, 404);
    const r = await fetch(`${s.url}/mcp`, { method: "POST", body: "{}" });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("www-authenticate"), "Bearer");
    assert.equal(((await (await fetch(`${s.url}/health`)).json()) as { oauth: boolean }).oauth, false);
  } finally {
    await s.app.close();
  }
});

test("the metadata says where to sign in, and a 401 points at it", async () => {
  const s = await setup();
  try {
    const resource = (await (await fetch(`${s.url}/.well-known/oauth-protected-resource`)).json()) as Record<
      string,
      unknown
    >;
    assert.equal(resource["resource"], "https://rides.example.org/mcp");
    assert.deepEqual(resource["authorization_servers"], ["https://rides.example.org"]);
    const server = (await (await fetch(`${s.url}/.well-known/oauth-authorization-server`)).json()) as Record<
      string,
      unknown
    >;
    assert.equal(server["token_endpoint"], "https://rides.example.org/oauth/token");
    assert.deepEqual(server["code_challenge_methods_supported"], ["S256"]);
    assert.deepEqual(server["token_endpoint_auth_methods_supported"], ["none"]);
    const r = await fetch(`${s.url}/mcp`, { method: "POST", body: "{}" });
    assert.equal(r.status, 401);
    assert.equal(
      r.headers.get("www-authenticate"),
      'Bearer resource_metadata="https://rides.example.org/.well-known/oauth-protected-resource"',
    );
  } finally {
    await s.app.close();
  }
});

test("a client registers only for the addresses of ChatGPT and Claude, or the host's own", async () => {
  const s = await setup({ redirects: ["https://assistant.example.org/callback"] });
  try {
    const claude = await s.register();
    assert.equal(claude.status, 201);
    assert.match(String(claude.body["client_id"]), /^mrc_/);
    assert.equal(claude.body["token_endpoint_auth_method"], "none");
    assert.equal(
      (await s.register()).body["client_id"],
      claude.body["client_id"],
      "the same request gives the same client",
    );
    assert.equal((await s.register("https://assistant.example.org/callback")).status, 201);
    const evil = await s.register("https://evil.example.com/steal");
    assert.equal(evil.status, 400);
    assert.equal(evil.body["error"], "invalid_redirect_uri");
  } finally {
    await s.app.close();
  }
});

test("the sign-in page shows the form for a known client, and refuses anything unchecked", async () => {
  const s = await setup();
  try {
    const client = (await s.register()).body["client_id"] as string;
    const ok = await fetch(`${s.url}/oauth/authorize?${s.authorizeQuery(client)}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    const html = await ok.text();
    assert.match(html, /name="link_code"/);
    assert.match(html, /Connect Claude/);
    for (const query of [
      s.authorizeQuery("mrc_unknown"),
      s.authorizeQuery(client, { redirect_uri: "https://evil.example.com/steal" }),
      s.authorizeQuery(client, { code_challenge_method: "plain" }),
      s.authorizeQuery(client, { code_challenge: "short" }),
      s.authorizeQuery(client, { response_type: "token" }),
    ]) {
      const r = await fetch(`${s.url}/oauth/authorize?${query}`, { redirect: "manual" });
      assert.equal(r.status, 400, query.toString());
      assert.equal(r.headers.get("location"), null);
    }
    // A name with markup is shown as text.
    const odd = (await s.register(CLAUDE, `<script>alert(1)</script>`)).body["client_id"] as string;
    assert.doesNotMatch(
      await (await fetch(`${s.url}/oauth/authorize?${s.authorizeQuery(odd)}`)).text(),
      /<script>alert/,
    );
  } finally {
    await s.app.close();
  }
});

test("a rider connects with a one-time code and the chat assistant uses /mcp with the token it gets", async () => {
  const s = await setup();
  try {
    const { exchanged, body } = await s.connectChat();
    assert.equal(exchanged.status, 200);
    assert.equal(body["token_type"], "Bearer");
    assert.match(body["access_token"]!, /^mro_/);
    assert.match(body["refresh_token"]!, /^mrr_/);
    const client = new Client({ name: "chat", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${body["access_token"]}` } },
      }),
    );
    assert.ok((await client.listTools()).tools.some((t) => t.name === "listRoadbooks"));
    await client.close();
    // The rider's own token still works beside it.
    assert.notEqual(await mcpStatus(s.url, s.alice.token), 401);
  } finally {
    await s.app.close();
  }
});

test("the code answers back with the state, works once, and a wrong or old code is refused", async () => {
  const s = await setup();
  try {
    const client = (await s.register()).body["client_id"] as string;
    const code = s.registry.linkCode(s.alice.tenant.id, 1_000_000).code;
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const first = await s.submit(client, code.toLowerCase().replace("-", " "));
    assert.equal(first.status, 302);
    const back = new URL(first.headers.get("location")!);
    assert.equal(`${back.origin}${back.pathname}`, CLAUDE);
    assert.equal(back.searchParams.get("state"), "xyz");
    assert.match(back.searchParams.get("code") ?? "", /^mrx_/);
    assert.equal((await s.submit(client, code)).status, 403, "a used code");
    assert.equal((await s.submit(client, "AAAA-AAAA")).status, 403, "an unknown code");
    const old = s.registry.linkCode(s.alice.tenant.id, 1_000_000).code;
    s.tick(11 * 60_000);
    assert.equal((await s.submit(client, old)).status, 403, "an expired code");
    // Cancel goes back with access_denied, and no code.
    const deny = await fetch(`${s.url}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(s.authorizeQuery(client)), decision: "deny" }),
    });
    assert.equal(new URL(deny.headers.get("location")!).searchParams.get("error"), "access_denied");
  } finally {
    await s.app.close();
  }
});

test("the token needs the right client, address and PKCE verifier, and an authorization code works once", async () => {
  const s = await setup();
  try {
    const client = (await s.register()).body["client_id"] as string;
    const authCode = async () => {
      const back = await s.submit(client, s.registry.linkCode(s.alice.tenant.id, 1_000_000).code);
      return new URL(back.headers.get("location")!).searchParams.get("code")!;
    };
    const base = { grant_type: "authorization_code", client_id: client, redirect_uri: CLAUDE, code_verifier: VERIFIER };
    for (const wrong of [
      { code_verifier: "w".repeat(60) },
      { code_verifier: "short" },
      { client_id: "mrc_other" },
      { redirect_uri: "https://evil.example.com/steal" },
    ]) {
      const r = await s.token({ ...base, code: await authCode(), ...wrong });
      assert.equal(r.status, 400);
      assert.equal(((await r.json()) as { error: string }).error, "invalid_grant");
    }
    const code = await authCode();
    const good = await s.token({ ...base, code });
    assert.equal(good.status, 200);
    const access = ((await good.json()) as { access_token: string }).access_token;
    assert.notEqual(await mcpStatus(s.url, access), 401);
    // The same code again is a stolen one: it fails and what it made is ended.
    assert.equal((await s.token({ ...base, code })).status, 400);
    assert.equal(await mcpStatus(s.url, access), 401);
    assert.equal((await s.token({ grant_type: "password" })).status, 400);
  } finally {
    await s.app.close();
  }
});

test("an access token lasts an hour, and a refresh token makes a new pair and ends the old one", async () => {
  const s = await setup();
  try {
    const { client, body } = await s.connectChat();
    const access = body["access_token"]!;
    s.tick(59 * 60_000);
    assert.notEqual(await mcpStatus(s.url, access), 401);
    s.tick(2 * 60_000);
    assert.equal(await mcpStatus(s.url, access), 401, "an hour has passed");
    const renewed = await s.token({
      grant_type: "refresh_token",
      client_id: client,
      refresh_token: body["refresh_token"]!,
    });
    assert.equal(renewed.status, 200);
    const next = (await renewed.json()) as Record<string, string>;
    assert.notEqual(await mcpStatus(s.url, next["access_token"]!), 401);
    assert.notEqual(next["refresh_token"], body["refresh_token"]);
    const again = await s.token({
      grant_type: "refresh_token",
      client_id: client,
      refresh_token: body["refresh_token"]!,
    });
    assert.equal(again.status, 400, "the old refresh token is spent");
    const other = await s.token({
      grant_type: "refresh_token",
      client_id: "mrc_other",
      refresh_token: next["refresh_token"]!,
    });
    assert.equal(other.status, 400, "another client cannot use it");
  } finally {
    await s.app.close();
  }
});

test("a connection token opens /mcp only, and stops when the rider is suspended, removed or its connections ended", async () => {
  const s = await setup();
  try {
    const { body } = await s.connectChat();
    const access = body["access_token"]!;
    for (const path of ["/rides", "/roadbooks"]) {
      const r = await fetch(`${s.url}${path}`, { headers: { Authorization: `Bearer ${access}` } });
      assert.equal(r.status, 401, path);
    }
    s.registry.setStatus(s.alice.tenant.id, "suspended");
    assert.equal(await mcpStatus(s.url, access), 401);
    s.registry.setStatus(s.alice.tenant.id, "active");
    assert.notEqual(await mcpStatus(s.url, access), 401);
    assert.equal(s.registry.revokeConnections(s.alice.tenant.id), 1);
    assert.equal(await mcpStatus(s.url, access), 401);
    const again = await s.connectChat();
    s.registry.remove(s.alice.tenant.id);
    assert.equal(await mcpStatus(s.url, again.body["access_token"]!), 401);
  } finally {
    await s.app.close();
  }
});

test("the app asks for a code with the rider's token, a few times a minute", async () => {
  const s = await setup();
  try {
    const ask = (secret?: string) =>
      fetch(`${s.url}/oauth/link-code`, {
        method: "POST",
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      });
    assert.equal((await ask()).status, 401);
    assert.equal((await ask("mro_nope")).status, 401);
    const made = await ask(s.alice.token);
    assert.equal(made.status, 200);
    const { code } = (await made.json()) as { code: string };
    assert.equal(s.registry.redeemLinkCode(code, 1_000_000)?.id, s.alice.tenant.id);
    let last = 200;
    for (let i = 0; i < 12; i++) last = (await ask(s.alice.token)).status;
    assert.equal(last, 429);
    assert.equal((await fetch(`${s.url}/oauth/link-code`)).status, 405);
  } finally {
    await s.app.close();
  }
});
