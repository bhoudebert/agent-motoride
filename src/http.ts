// Contact-style agent string: some public instances reject free-text or browser-like agents.
const USER_AGENT = "agentMotoride/0.1 (+https://github.com/bhoudebert/agent-motoride)";

/** The public Valhalla server asks apps that use it to say who they are, beside the User-Agent (FOSSGIS demo server notice). */
export const VALHALLA_CLIENT_ID = "agentmotoride";

/** The public Valhalla server, used when the host runs none of their own. */
export const PUBLIC_VALHALLA = "https://valhalla1.openstreetmap.de";

/**
 * Where routes and traces are asked for: the host's own Valhalla when `VALHALLA_URL` is set (docs/guide/self-hosting.md), else the public
 * server. Read at each use, so a change of environment needs no restart of the code that asks.
 */
export function valhallaUrl(): string {
  const set = process.env.VALHALLA_URL?.trim();
  if (!set) return PUBLIC_VALHALLA;
  let url: URL;
  try {
    url = new URL(set);
  } catch {
    throw new Error(`VALHALLA_URL is not a URL: ${set}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`VALHALLA_URL must be http or https: ${set}`);
  return url.toString().replace(/\/+$/, "");
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
    throw new Error(`${new URL(url).host} responded ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}
