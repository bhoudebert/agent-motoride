const USER_AGENT = "agentRide/0.1 (personal motorcycle trip planner)";

/** fetch + JSON with a timeout and a readable error on non-2xx responses. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
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
