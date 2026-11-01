import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Registry, Tenant } from "./tenants.ts";

/**
 * Sign-in for chat clients (ADR 0056): ChatGPT and Claude connect to `/mcp` with OAuth 2.1 (authorization code with PKCE, clients
 * that register themselves), beside the bearer token of Claude Code and Codex. The rider proves who they are with a one-time code
 * read in the app (or printed by `npm run admin -- link`), never a password; the tokens that result only open `/mcp`.
 */

/** The addresses a registering client may ask to be sent back to; a host adds its own with RIDE_OAUTH_REDIRECTS. */
export const DEFAULT_REDIRECTS = [
  // Claude (claude.ai, Desktop, mobile): https://claude.com/docs/connectors/building/authentication.md
  "https://claude.ai/api/mcp/auth_callback",
  // ChatGPT: from community and third-party guides, not from OpenAI's own text: to be checked against a real connection.
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://platform.openai.com/apps-manage/oauth",
];

/** What the sign-in page calls a client: by the address it is sent back to, which is on our list, never by what it says it is. */
export function assistantName(redirectUri: string): string {
  const host = new URL(redirectUri).hostname;
  if (host === "claude.ai" || host === "claude.com") return "Claude";
  if (host === "chatgpt.com" || host === "platform.openai.com") return "ChatGPT";
  return host;
}

export interface OAuthOptions {
  registry: Registry;
  /** The public address of this server, https://rides.example.org: the issuer, and where the metadata says things are. */
  baseUrl: string;
  /** More addresses a client may be sent back to. */
  redirects?: string[];
  now?: () => number;
}

export interface OAuth {
  /** Answers the requests that are OAuth's (true), or leaves them (false). */
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  /** Who a chat connection's access token identifies. */
  verify(token: string): Tenant | null;
  /** What `WWW-Authenticate` says on a 401, so a client knows where to sign in. */
  challenge: string;
}

const MAX_BODY = 4096;
const SCOPE = "mcp";

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    ...headers,
  });
  res.end(JSON.stringify(body));
};

const escape = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function readText(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A form (the sign-in page, the token request) or JSON (the registration, and tokens from a client that sends it so). */
async function readParams(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const text = await readText(req);
  if (text === null) return null;
  const type = String(req.headers["content-type"] ?? "").toLowerCase();
  if (type.startsWith("application/json")) {
    try {
      const body: unknown = text ? JSON.parse(text) : {};
      return typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

const text = (value: unknown, max = 2000): string => (typeof value === "string" && value.length <= max ? value : "");

const bearer = (req: IncomingMessage): string | null => {
  const match = req.headers.authorization ? /^Bearer\s+(\S+)$/i.exec(req.headers.authorization) : null;
  return match ? match[1]! : null;
};

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";

interface Ask {
  clientId: string;
  clientName: string;
  redirectUri: string;
  challenge: string;
  state: string;
}

function page(res: ServerResponse, status: number, body: string, title = "Connect to agentMotoride"): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": PAGE_CSP,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><style>
body{font:17px/1.5 system-ui,sans-serif;margin:0;background:#f2eee3;color:#1d2b24}
main{max-width:30rem;margin:0 auto;padding:2rem 1.25rem}
h1{font-size:1.5rem;margin:0 0 .75rem}
input[type=text]{font:inherit;font-size:1.4rem;letter-spacing:.2em;text-transform:uppercase;width:100%;box-sizing:border-box;padding:.6rem;border:2px solid #1d2b24;border-radius:6px;background:#fff}
button{font:inherit;font-weight:600;padding:.7rem 1.2rem;border-radius:6px;border:2px solid #1d2b24;background:#e7b324;color:#1d2b24;cursor:pointer}
button.quiet{background:transparent}
.error{background:#f6d6cf;border:2px solid #a8412b;padding:.6rem .8rem;border-radius:6px}
.row{display:flex;gap:.75rem;margin-top:1rem}small{color:#51615a}
</style></head><body><main>${body}</main></body></html>`);
}

export function createOAuth(options: OAuthOptions): OAuth {
  const { registry, now = Date.now } = options;
  const base = options.baseUrl.replace(/\/+$/, "");
  const allowed = new Set([...DEFAULT_REDIRECTS, ...(options.redirects ?? [])]);
  const windows = new Map<string, { start: number; count: number }>();
  const resource = `${base}/mcp`;
  const metadataUrl = `${base}/.well-known/oauth-protected-resource`;

  /** At most `max` calls a minute under `key`; true when this one is too many. */
  const tooMany = (key: string, max: number): boolean => {
    const t = now();
    const w = windows.get(key);
    if (!w || t - w.start >= 60_000) {
      windows.set(key, { start: t, count: 1 });
      return false;
    }
    return ++w.count > max;
  };

  const protectedResource = {
    resource,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE],
  };
  const authorizationServer = {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };

  /** Registration of a client (RFC 7591): only addresses on the list, so nobody can ask to be sent a code somewhere else. */
  async function register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return send(res, 405, { error: "invalid_request" }, { Allow: "POST" });
    if (tooMany("register", 20)) return send(res, 429, { error: "temporarily_unavailable" }, { "Retry-After": "60" });
    const params = await readParams(req);
    if (!params) return send(res, 400, { error: "invalid_client_metadata" });
    const uris = Array.isArray(params["redirect_uris"]) ? (params["redirect_uris"] as unknown[]) : [];
    if (!uris.length || uris.length > 5 || !uris.every((u) => typeof u === "string" && allowed.has(u)))
      return send(res, 400, {
        error: "invalid_redirect_uri",
        error_description: "This server only sends a code back to the addresses of ChatGPT and Claude it knows.",
      });
    const name =
      [...text(params["client_name"], 100)]
        .filter((c) => c >= " ")
        .join("")
        .trim() || "A chat assistant";
    const made = registry.registerClient(name, uris as string[], now());
    if (!made) return send(res, 429, { error: "temporarily_unavailable" }, { "Retry-After": "3600" });
    return send(res, 201, {
      client_id: made.id,
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    });
  }

  /** What the sign-in page needs from a request, or why it cannot go on (nothing is sent to an address that is not checked). */
  function ask(params: Record<string, unknown>): Ask | string {
    const client = registry.client(text(params["client_id"], 100));
    if (!client) return "This connection request is not known. Start again from the chat assistant.";
    const given = text(params["redirect_uri"]);
    const redirectUri = given || (client.redirectUris.length === 1 ? client.redirectUris[0]! : "");
    if (!redirectUri || !client.redirectUris.includes(redirectUri))
      return "This connection request comes from an address that is not allowed.";
    if (text(params["response_type"]) !== "code") return "Only the authorization code flow is supported.";
    const challenge = text(params["code_challenge"], 128);
    if (text(params["code_challenge_method"]) !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
      return "The request has no valid PKCE challenge (S256).";
    return { clientId: client.id, clientName: client.name, redirectUri, challenge, state: text(params["state"], 500) };
  }

  const form = (a: Ask, error = "") => `
<h1>Connect ${escape(a.clientName)}</h1>
<p>${escape(a.clientName)} asks to use your ride library: plan rides, read and change your roadbooks, notes and ratings.</p>
<p><strong>Continue only if you started this yourself</strong>, just now, from ${escape(a.clientName)}. If someone sent you this page, or asked you for the code, close it: a code gives them your library.</p>
${error ? `<p class="error">${escape(error)}</p>` : ""}
<form method="post" action="/oauth/authorize" autocomplete="off">
  <input type="hidden" name="client_id" value="${escape(a.clientId)}">
  <input type="hidden" name="redirect_uri" value="${escape(a.redirectUri)}">
  <input type="hidden" name="code_challenge" value="${escape(a.challenge)}">
  <input type="hidden" name="code_challenge_method" value="S256">
  <input type="hidden" name="response_type" value="code">
  <input type="hidden" name="state" value="${escape(a.state)}">
  <p><label for="code">The one-time code from your app or from whoever runs this server:</label></p>
  <p><input id="code" name="link_code" type="text" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12" required autofocus placeholder="ABCD-EFGH"></p>
  <div class="row"><button type="submit" name="decision" value="allow">Connect</button><button class="quiet" type="submit" name="decision" value="deny" formnovalidate>Cancel</button></div>
</form>
<p><small>The code works once and lasts ten minutes. Connecting ends when you disconnect in the chat assistant or your host ends it.</small></p>`;

  const back = (a: Ask, extra: Record<string, string>): string => {
    const target = new URL(a.redirectUri);
    for (const [k, v] of Object.entries(extra)) target.searchParams.set(k, v);
    if (a.state) target.searchParams.set("state", a.state);
    return target.toString();
  };

  async function authorize(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method === "GET") {
      const asked = ask(Object.fromEntries(url.searchParams));
      if (typeof asked === "string") return page(res, 400, `<h1>Cannot connect</h1><p>${escape(asked)}</p>`);
      return page(res, 200, form(asked));
    }
    if (req.method !== "POST") return send(res, 405, { error: "invalid_request" }, { Allow: "GET, POST" });
    const params = await readParams(req);
    const asked = params ? ask(params) : "The request is not readable.";
    if (typeof asked === "string") return page(res, 400, `<h1>Cannot connect</h1><p>${escape(asked)}</p>`);
    if (text(params?.["decision"], 10) === "deny") {
      res.writeHead(302, { Location: back(asked, { error: "access_denied" }), "Cache-Control": "no-store" });
      return void res.end();
    }
    // Whoever asks, only so many tries a minute in all: a code is 39 random bits and lives ten minutes.
    if (tooMany("authorize", 30)) return page(res, 429, form(asked, "Too many tries; wait a minute."));
    const tenant = registry.redeemLinkCode(text(params?.["link_code"], 40), now());
    if (!tenant)
      return page(res, 403, form(asked, "That code is not valid. It may have expired or been used: make a new one."));
    const code = registry.issueAuthCode(asked.clientId, tenant.id, asked.redirectUri, asked.challenge, now());
    res.writeHead(302, {
      Location: back(asked, { code }),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    return void res.end();
  }

  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return send(res, 405, { error: "invalid_request" }, { Allow: "POST" });
    if (tooMany("token", 120)) return send(res, 429, { error: "temporarily_unavailable" }, { "Retry-After": "30" });
    const params = await readParams(req);
    if (!params) return send(res, 400, { error: "invalid_request" });
    const clientId = text(params["client_id"], 100);
    const grant = text(params["grant_type"], 40);
    let made: { access: string; refresh: string; expiresIn: number } | null;
    if (grant === "authorization_code") {
      made = registry.exchangeAuthCode(
        text(params["code"], 100),
        clientId,
        text(params["redirect_uri"]),
        text(params["code_verifier"], 200),
        now(),
      );
    } else if (grant === "refresh_token") {
      made = registry.refreshTokens(text(params["refresh_token"], 100), clientId, now());
    } else return send(res, 400, { error: "unsupported_grant_type" });
    if (!made) return send(res, 400, { error: "invalid_grant" });
    return send(res, 200, {
      access_token: made.access,
      token_type: "Bearer",
      expires_in: made.expiresIn,
      refresh_token: made.refresh,
      scope: SCOPE,
    });
  }

  /** The app (or any client holding a rider's token) asks for the code to type in the chat assistant. */
  function linkCode(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." }, { Allow: "POST" });
    const secret = bearer(req);
    const tenant = secret ? registry.verify(secret) : null;
    if (!tenant) return send(res, 401, { error: "A rider's token is needed." }, { "WWW-Authenticate": "Bearer" });
    if (tooMany(`link:${tenant.id}`, 10))
      return send(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "60" });
    const made = registry.linkCode(tenant.id, now());
    return send(res, 200, { code: made.code, expiresAt: made.expiresAt });
  }

  return {
    challenge: `Bearer resource_metadata="${metadataUrl}"`,
    verify: (secret) => registry.verifyOauth(secret, now()),
    async handle(req, res, url) {
      const path = url.pathname;
      if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
        send(res, 200, protectedResource, { "Cache-Control": "public, max-age=300" });
        return true;
      }
      if (
        path === "/.well-known/oauth-authorization-server" ||
        path === "/.well-known/oauth-authorization-server/mcp"
      ) {
        send(res, 200, authorizationServer, { "Cache-Control": "public, max-age=300" });
        return true;
      }
      if (path === "/oauth/register") return (void (await register(req, res)), true);
      if (path === "/oauth/authorize") return (void (await authorize(req, res, url)), true);
      if (path === "/oauth/token") return (void (await token(req, res)), true);
      if (path === "/oauth/link-code") return (void linkCode(req, res), true);
      return false;
    },
  };
}

/** The PKCE challenge of a verifier (S256): tests and clients make one. */
export const challengeOf = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");
