// Contact-style agent string: some public instances reject free-text or browser-like agents.
const USER_AGENT = "agentMotoride/0.1 (+https://github.com/bhoudebert/agent-motoride)";

/** The public Valhalla server asks apps that use it to say who they are, beside the User-Agent (FOSSGIS demo server notice). */
export const VALHALLA_CLIENT_ID = "agentmotoride";

/** The public Valhalla server, used when the host runs none of their own. */
export const PUBLIC_VALHALLA = "https://valhalla1.openstreetmap.de";

/** One address of a Valhalla server, checked: http or https, no trailing slash. */
function checkedUrl(set: string, whole: string): string {
  let url: URL;
  try {
    url = new URL(set);
  } catch {
    throw new Error(`VALHALLA_URL is not a URL: ${set}${set === whole ? "" : ` (in ${whole})`}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`VALHALLA_URL must be http or https: ${set}`);
  return url.toString().replace(/\/+$/, "");
}

/**
 * The Valhalla servers routes and traces are asked of: the host's own when `VALHALLA_URL` is set (one address, or several
 * separated by commas, docs/guide/self-hosting.md), else the public server. Read at each use, so a change of environment
 * needs no restart of the code that asks.
 */
export function valhallaUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const set = env.VALHALLA_URL?.trim();
  if (!set) return [PUBLIC_VALHALLA];
  const urls = set
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u !== "")
    .map((u) => checkedUrl(u, set));
  return urls.length ? urls : [PUBLIC_VALHALLA];
}

/** The first Valhalla server of the list: the one a single-address setup names. */
export function valhallaUrl(): string {
  return valhallaUrls()[0]!;
}

/** A response that was not 2xx; `status` tells a request that is wrong (4xx) from a server that is not well (5xx, 429). */
export class HttpError extends Error {
  readonly status: number;
  constructor(url: string, status: number, body: string) {
    super(`${new URL(url).host} responded ${status}: ${body}`);
    this.status = status;
  }
}

/** fetch + JSON with a timeout and a readable error on non-2xx responses. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new HttpError(url, res.status, body);
  }
  return (await res.json()) as T;
}

/** How long a ranking of the servers is kept, ms. */
const RANK_TTL_MS = 5 * 60 * 1000;
const STATUS_TIMEOUT_MS = 3000;
const ranking = new Map<string, { at: number; order: string[] }>();

/** When the tiles of a Valhalla server were built (epoch seconds), or null when it does not answer or does not say. */
async function tilesetBuilt(url: string): Promise<number | null> {
  try {
    const status = await fetchJson<{ tileset_last_modified?: number }>(`${url}/status`, {}, STATUS_TIMEOUT_MS);
    return typeof status.tileset_last_modified === "number" ? status.tileset_last_modified : null;
  } catch {
    return null;
  }
}

/** The servers, the one with the newest map first; those that do not answer or do not say come last, in the order given. */
async function freshestFirst(urls: string[], now = Date.now()): Promise<string[]> {
  const key = urls.join(",");
  const kept = ranking.get(key);
  if (kept && now - kept.at < RANK_TTL_MS) return kept.order;
  const built = await Promise.all(urls.map(tilesetBuilt));
  const order = urls
    .map((url, i) => ({ url, i, built: built[i]! }))
    .sort((a, b) => (b.built ?? -1) - (a.built ?? -1) || a.i - b.i)
    .map((s) => s.url);
  ranking.set(key, { at: now, order });
  return order;
}

/** Forgets what is known of the servers' freshness (tests). */
export function resetValhallaRanking(): void {
  ranking.clear();
}

/** A failure that another server may not have: no answer, or a server that is down, busy or over its rate limit. */
function worthAnotherServer(e: unknown): boolean {
  return !(e instanceof HttpError) || e.status >= 500 || e.status === 429;
}

/**
 * A request to Valhalla (`path` like "/route"). With one server it goes there. With several it goes to the one whose map is
 * newest (asked of /status, kept five minutes) and, when that one cannot answer, to the next, so a server that is rebuilding
 * costs nothing. A request the server refuses as wrong (4xx other than 429) is not tried elsewhere.
 */
export async function valhallaJson<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const urls = valhallaUrls();
  if (urls.length === 1) return fetchJson<T>(`${urls[0]}${path}`, init, timeoutMs);
  const order = await freshestFirst(urls);
  let last: unknown;
  for (const url of order) {
    try {
      return await fetchJson<T>(`${url}${path}`, init, timeoutMs);
    } catch (e) {
      if (!worthAnotherServer(e)) throw e;
      last = e;
      // What was known of the servers is no longer true.
      ranking.clear();
    }
  }
  throw new Error(
    `No Valhalla server answered (${urls.length} tried): ${last instanceof Error ? last.message : String(last)}`,
    {
      cause: last,
    },
  );
}
