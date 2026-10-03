// Environment check: what each mode needs, which services answer from here,
// and the state of the database. No model call, no cost.
import { existsSync } from "node:fs";
import { fetchJson } from "./http.ts";
import { MODEL, SCOUT_MODEL } from "./model.ts";
import { describeProfile } from "./profile.ts";
import { Store } from "./store.ts";
import { resolvePoint } from "./tools/geo.ts";
import { isKnownModel } from "./usage.ts";

type Level = "ok" | "warn" | "fail";
const rows: Array<[Level, string, string]> = [];
const add = (level: Level, what: string, detail: string) => rows.push([level, what, detail]);
const timed = async <T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> => {
  const t = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t, value };
  } catch (error) {
    return { ms: Date.now() - t, error: error instanceof Error ? error.message.slice(0, 90) : String(error) };
  }
};

// Runtime
const major = Number(process.versions.node.split(".")[0]);
add(major >= 24 ? "ok" : "fail", "Node", `${process.versions.node}${major >= 24 ? "" : " (24 or newer needed: runs TypeScript directly, has SQLite built in)"}`);

// Modes
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
add(hasKey ? "ok" : "warn", "API mode", hasKey ? `credentials set; model ${MODEL}${isKnownModel(MODEL) ? "" : " (UNKNOWN model id, check the spelling)"}` : "no ANTHROPIC_API_KEY: the terminal planner cannot run; MCP mode still can");
if (hasKey && !isKnownModel(MODEL)) add("fail", "RIDE_MODEL", `"${MODEL}" is not a model this app knows`);
add(existsSync(".mcp.json") ? "ok" : "warn", "MCP mode", existsSync(".mcp.json") ? `.mcp.json present: start Claude Code here and approve the "ride" server. Scouts ${hasKey ? `run on ${SCOUT_MODEL} with the key` : "are unavailable without a key"}${process.env.RIDE_SCOUTS === "0" ? " (disabled by RIDE_SCOUTS=0)" : ""}` : ".mcp.json missing");

// Start point
if (process.env.RIDE_HOME) {
  const home = await timed(() => resolvePoint(process.env.RIDE_HOME!));
  add(home.value ? "ok" : "fail", "RIDE_HOME", home.value ? `${process.env.RIDE_HOME} -> ${home.value.label}` : `could not resolve "${process.env.RIDE_HOME}": ${home.error}`);
} else add("warn", "RIDE_HOME", "not set: pass --from each time, or set it in .env");

// Services
const geocode = await timed(() => fetchJson<{ results?: unknown[] }>("https://geocoding-api.open-meteo.com/v1/search?name=Lille&count=1"));
add(geocode.value ? "ok" : "fail", "Open-Meteo geocoding", geocode.value ? `${geocode.ms} ms` : geocode.error!);
const forecast = await timed(() => fetchJson<{ hourly?: unknown }>("https://api.open-meteo.com/v1/forecast?latitude=50.63&longitude=3.06&hourly=temperature_2m&forecast_days=1"));
add(forecast.value ? "ok" : "fail", "Open-Meteo forecast", forecast.value ? `${forecast.ms} ms` : forecast.error!);
const route = await timed(() =>
  fetchJson<{ trip?: unknown }>("https://valhalla1.openstreetmap.de/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locations: [{ lat: 50.63, lon: 3.06 }, { lat: 50.64, lon: 3.08 }], costing: "motorcycle", directions_type: "none" }) }, 20_000),
);
add(route.value ? "ok" : "fail", "Valhalla routing", route.value ? `${route.ms} ms` : route.error!);
const photon = await timed(() => fetchJson<{ features?: unknown[] }>("https://photon.komoot.io/api/?q=Lille&limit=1", {}, 10_000));
add(photon.value ? "ok" : "warn", "Photon (addresses)", photon.value ? `${photon.ms} ms` : photon.error!);
for (const [name, url] of [["Overpass main", "https://overpass-api.de/api/interpreter"], ["Overpass OSM France", "https://overpass.openstreetmap.fr/api/interpreter"]] as const) {
  const r = await timed(() =>
    fetchJson<{ elements?: unknown[]; remark?: string }>(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent('[out:json][timeout:10];node(50.63,3.05,50.64,3.06)["amenity"="fuel"];out 1;')}` }, 20_000),
  );
  const detail = r.value ? `${r.ms} ms${r.value.remark ? ` (remark: ${r.value.remark.slice(0, 50)})` : ""}` : r.error!.includes("403") ? "403: User-Agent rejected (keep the contact-style agent in src/http.ts)" : r.error!.includes("fetch failed") ? "connection refused: this instance is blocking your address for now; the app falls back on the other" : r.error!;
  add(r.value ? "ok" : "warn", name, detail);
}
add(process.env.TOMTOM_API_KEY ? "ok" : "warn", "TomTom traffic", process.env.TOMTOM_API_KEY ? "key set" : "no TOMTOM_API_KEY: traffic reported as not checked");

// Database
const store = new Store();
const rides = store.listRides();
const runs = store.listRuns();
add("ok", "Database", `${store.path}: ${rides.length} rides, ${runs.length} runs`);
add("ok", "Bike profile", describeProfile(store.getProfile()));
const stale = rides.filter((r) => !r.shapes || !r.extras);
if (stale.length) add("warn", "Saved rides", `${stale.length} ride(s) saved before route lines or extras existed: npm run rides -- refresh all`);
store.close();

const width = Math.max(...rows.map((r) => r[1].length));
for (const [level, what, detail] of rows) console.log(`${{ ok: " ok ", warn: "WARN", fail: "FAIL" }[level]}  ${what.padEnd(width)}  ${detail}`);
const fails = rows.filter((r) => r[0] === "fail").length;
console.log(fails ? `\n${fails} problem(s) to fix.` : "\nReady.");
process.exit(fails ? 1 : 0);
