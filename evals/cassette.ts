// Record and replay every HTTP exchange of a planning session: the model's
// replies and the public map, routing and weather services. A replayed session
// makes no network call and costs nothing, so it can run in CI.
import { createHash } from "node:crypto";

export interface Exchange {
  key: string;
  /** "model" for the Claude API, "tool" for everything else. */
  kind: "model" | "tool";
  url: string;
  status: number;
  body: string;
  /** Model calls only: hash of the full request, to report prompt or tool-output drift on replay. */
  requestHash?: string;
}

export interface Cassette {
  caseId: string;
  recordedAt: string;
  /** The session's "now", so dates in the request resolve as they did when recorded. */
  now: string;
  model: string;
  effort: string;
  costUsd: number;
  /** Grader results at recording time; a replay must not do worse. */
  scores: Record<string, boolean>;
  exchanges: Exchange[];
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
/** The Claude API, wherever ANTHROPIC_BASE_URL points it. Exact domain match: "evilanthropic.com" is not it. */
const isModel = (url: URL) =>
  url.hostname === "anthropic.com" || url.hostname.endsWith(".anthropic.com") || url.pathname.endsWith("/v1/messages");

/** Query parameters that carry credentials (TomTom puts its key in the URL). */
const SECRET_PARAM = /^(key|api[-_]?key|access[-_]?token|token|secret|signature|sig)$/i;

/**
 * The URL with credential parameters replaced, as stored in a cassette and used
 * in request keys: cassettes are committed to a public repository.
 */
export function redactUrl(url: URL): string {
  const copy = new URL(url);
  for (const name of [...copy.searchParams.keys()])
    if (SECRET_PARAM.test(name)) copy.searchParams.set(name, "REDACTED");
  return copy.toString();
}

/**
 * Refuse a cassette that contains the value of any credential in the
 * environment, wherever it hides (URL, body, headers echoed by a service).
 * Called before a cassette is written to disk.
 */
export function assertNoSecrets(cassette: Cassette, env: NodeJS.ProcessEnv = process.env): void {
  const text = JSON.stringify(cassette);
  // Credentials by name, long enough to be real values rather than flags.
  const leaked = Object.entries(env).filter(
    ([name, value]) =>
      /KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value !== undefined && value.length >= 8 && text.includes(value),
  );
  if (leaked.length) {
    throw new Error(
      `Cassette ${cassette.caseId} contains the value of ${leaked.map(([n]) => n).join(", ")}; not written.`,
    );
  }
}

/**
 * Model requests are keyed by conversation and turn: the first user message
 * (the planner's request, or a scout's brief) and the number of messages so far.
 * That identifies the same step across runs even when a prompt or a tool's
 * output changed, which a replay should survive and report, not fail on.
 * Tool requests are keyed by method, URL and body.
 */
export function exchangeKey(url: URL, method: string, body: string): { key: string; requestHash?: string } {
  if (!isModel(url)) return { key: `${method} ${redactUrl(url)} ${sha(body)}` };
  const request = JSON.parse(body) as { messages: Array<{ content: unknown }> };
  const first = JSON.stringify(request.messages[0]?.content ?? "");
  return { key: `model ${sha(first)} #${request.messages.length}`, requestHash: sha(body) };
}

const bodyText = (init: RequestInit | undefined) =>
  init?.body === undefined || init.body === null ? "" : String(init.body as string | URLSearchParams);

/** The body is already decoded: keep the type, drop encoding and length. */
const jsonHeaders = (response: Response) => ({
  "content-type": response.headers.get("content-type") ?? "application/json",
});

export interface Recorder {
  exchanges: Exchange[];
  restore(): void;
}

/**
 * Pass every request through to the real services and keep the answers.
 * `transform` may rewrite a tool answer before the session sees it (and before
 * it is kept): that is how eval cases plant hostile text in map data.
 */
export function record(transform?: (url: URL, body: string) => string): Recorder {
  const real = globalThis.fetch;
  const byKey = new Map<string, Exchange>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const sent = bodyText(init);
    const response = await real(input, init);
    let body = await response.text();
    if (!isModel(url) && response.ok && transform) body = transform(url, body);
    const { key, requestHash } = exchangeKey(url, method, sent);
    // A retried request keeps its last answer.
    byKey.set(key, {
      key,
      kind: isModel(url) ? "model" : "tool",
      url: redactUrl(url),
      status: response.status,
      body,
      requestHash,
    });
    return new Response(body, { status: response.status, headers: jsonHeaders(response) });
  }) as typeof fetch;
  return {
    get exchanges() {
      return [...byKey.values()];
    },
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

export interface Replayer {
  /** Requests the cassette had no answer for. */
  misses: string[];
  /** Model steps whose request differs from the recorded one (prompt or tool output changed). */
  drift: string[];
  /** Tool answers fetched live because of `updateTools`; added to the cassette by the caller. */
  added: Exchange[];
  restore(): void;
}

/**
 * Serve every request from the cassette. Nothing reaches the network, except
 * missing tool answers when `updateTools` is set: public services are free,
 * so refreshing them costs nothing, unlike a new model call.
 */
export function replay(cassette: Cassette, options: { updateTools?: boolean } = {}): Replayer {
  const real = globalThis.fetch;
  const byKey = new Map(cassette.exchanges.map((e) => [e.key, e]));
  const state: Replayer = { misses: [], drift: [], added: [], restore: () => (globalThis.fetch = real) };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const sent = bodyText(init);
    const { key, requestHash } = exchangeKey(url, init?.method ?? "GET", sent);
    const hit = byKey.get(key);
    if (hit) {
      if (requestHash && hit.requestHash && requestHash !== hit.requestHash) state.drift.push(key);
      return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json" } });
    }
    if (!isModel(url) && options.updateTools) {
      const response = await real(input, init);
      const body = await response.text();
      const exchange: Exchange = { key, kind: "tool", url: redactUrl(url), status: response.status, body };
      byKey.set(key, exchange);
      state.added.push(exchange);
      return new Response(body, { status: response.status, headers: jsonHeaders(response) });
    }
    state.misses.push(`${isModel(url) ? "model" : "tool"}: ${url.host}${url.pathname}`);
    // A model miss must never fall through to the real API: it would bill.
    return new Response(JSON.stringify({ type: "error", error: { type: "not_found", message: "not in cassette" } }), {
      status: isModel(url) ? 400 : 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return state;
}
