import { readFileSync } from "node:fs";
import { fetchJson } from "./http.ts";

/** The agentRide server a rider pushes roadbooks to: `RIDE_REMOTE_URL` and the rider's token `RIDE_REMOTE_TOKEN`. */
export function remoteConfig(env: NodeJS.ProcessEnv = process.env): { url: string; token: string } | null {
  const url = env["RIDE_REMOTE_URL"]?.trim().replace(/\/+$/, "");
  const token = env["RIDE_REMOTE_TOKEN"]?.trim();
  if (!url && !token) return null;
  if (!url || !token) throw new Error("Both RIDE_REMOTE_URL and RIDE_REMOTE_TOKEN are needed to push to a server.");
  if (!/^https?:\/\//i.test(url))
    throw new Error("RIDE_REMOTE_URL must start with https:// (or http:// on your own network).");
  return { url, token };
}

/** Send a roadbook file to the rider's server; the phone lists it there. Returns what the server kept. */
export async function pushRoadbookFile(
  body: string,
  config: { url: string; token: string },
  get: typeof fetchJson = fetchJson,
): Promise<{ id: number; stamp: string; replaced: boolean }> {
  try {
    return await get<{ id: number; stamp: string; replaced: boolean }>(
      `${config.url}/roadbooks`,
      { method: "PUT", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body },
      60_000,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/\b401\b/.test(message))
      throw new Error("The server refused the token (RIDE_REMOTE_TOKEN): it is wrong, replaced or suspended.", {
        cause: e,
      });
    if (/\b413\b/.test(message)) throw new Error("The server found the roadbook file too large.", { cause: e });
    throw new Error(`Could not push to ${config.url}: ${message.slice(0, 160)}`, { cause: e });
  }
}

/** Push the roadbook file at `path` to the configured server; the line to tell the rider. */
export async function pushExported(path: string, config = remoteConfig()): Promise<string> {
  if (!config)
    throw new Error("No server to push to: set RIDE_REMOTE_URL and RIDE_REMOTE_TOKEN (your server and your token).");
  const kept = await pushRoadbookFile(readFileSync(path, "utf8"), config);
  return `Pushed to ${config.url}: ${kept.replaced ? "replaced the earlier copy" : "new"}, version ${kept.stamp}. The MotoRide app lists it under your server.`;
}
