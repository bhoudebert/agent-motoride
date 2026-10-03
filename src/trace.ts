import type { SavedRun } from "./store.ts";
import { formatUsage } from "./usage.ts";

interface Event {
  id: number;
  at: string;
  scope: string;
  kind: string;
  name: string;
  ms: number | null;
  payload: unknown;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** One line saying what a tool call produced, from its recorded output. */
function summariseTool(name: string, payload: any): string {
  if (payload?.error) return `FAILED: ${clip(String(payload.error), 120)}`;
  const o = payload?.output ?? {};
  switch (name) {
    case "searchRoads":
      return `${o.roadsConsidered ?? "?"} roads, area median curviness ${o.areaMedianCurviness ?? "?"}, top: ${(o.roads ?? [])
        .slice(0, 3)
        .map((r: any) => `${r.ref} (${r.curvinessDegPerKm})`)
        .join(", ")}`;
    case "calculateTrip": {
      const s = o.speedLimits ?? {};
      return `${o.routeId}: ${o.totalDistanceKm} km, ${o.totalRidingTime}, open ${s.openRoadPct ?? "?"}%, 50z ${s.limit31to50?.pct ?? "?"}%, 30z ${s.limit30OrLess?.pct ?? "?"}%${o.usesMotorway ? ", MOTORWAY" : ""} | ${clip(o.savedRides?.verdict ?? "", 60)}`;
    }
    case "getWeather": {
      const s = o.summary ?? {};
      return `${o.location}: ${s.dry ? "dry" : "rain risk"}, rain prob max ${s.maxRainProbPct}%, ${s.totalRainMm} mm, ${s.minTempC}-${s.maxTempC}°C`;
    }
    case "listSavedRides":
      return `${o.count} saved ride(s) within ${o.radiusKm} km`;
    case "getTraffic":
      return o.available === false ? "no traffic source" : `delay ${o.trafficDelayMinutes} min, ${o.travelMinutes} min with traffic`;
    case "scoutAreas":
      return `${(o.reports ?? []).length} report(s): ${(o.reports ?? [])
        .map((r: any) => `${r.area} ${r.found ? `${r.routeId ?? "?"} ${r.distanceKm} km open ${r.openRoadPct}%` : "nothing"}`)
        .join("; ")}${o.notes?.length ? ` | ${o.notes.join(" ")}` : ""}`;
    default:
      return clip(JSON.stringify(o), 120);
  }
}

/** Replay of one planning session as a timeline, with a summary. */
export function formatTrace(run: SavedRun, events: Event[], full = false): string {
  const lines: string[] = [
    `Run #${run.id}  ${run.startedAt.slice(0, 16).replace("T", " ")}  |  ${run.usage.model}, effort ${run.usage.effort}  |  from ${run.home}`,
    `Request: ${clip(run.request, 200)}`,
    "",
  ];
  if (events.length === 0) return `${lines[0]}\nNo trace recorded for this run.`;
  const t0 = Date.parse(events[0]!.at);
  const scopeWidth = Math.max(...events.map((e) => e.scope.length));
  const toolStats = new Map<string, { calls: number; ms: number; failed: number }>();

  for (const e of events) {
    const p: any = e.payload;
    const when = secs(Date.parse(e.at) - t0).padStart(7);
    const scope = e.scope.padEnd(scopeWidth);
    let text: string;
    switch (e.kind) {
      case "user":
        text = `you      ${clip(String(p).replace(/\s+/g, " "), 140)}`;
        break;
      case "model": {
        const tools = p.tools?.length ? `calls ${p.tools.join(", ")}` : p.stopReason === "end_turn" ? "final answer" : p.stopReason;
        text = `model    ${tools}  [${k(p.tokens.in + p.tokens.cacheWrite)} in, ${k(p.tokens.cacheRead)} cached, ${k(p.tokens.out)} out]${p.text && p.stopReason !== "end_turn" ? `  "${clip(p.text.replace(/\s+/g, " "), 80)}"` : ""}`;
        break;
      }
      case "tool": {
        const stat = toolStats.get(e.name) ?? { calls: 0, ms: 0, failed: 0 };
        stat.calls++;
        stat.ms += e.ms ?? 0;
        if (p?.error) stat.failed++;
        toolStats.set(e.name, stat);
        text = `tool     ${e.name}(${clip(JSON.stringify(p?.input ?? {}), 90)})  ${e.ms === null ? "" : secs(e.ms)}  -> ${summariseTool(e.name, p)}`;
        break;
      }
      case "answer":
        text =
          e.scope === "main"
            ? `answer   ${p.ride ? `itinerary "${p.ride.name}" on ${p.ride.routeId}, ${p.ride.rideDate ?? "no date"} ${p.ride.departure ?? ""}` : "plain answer"}: "${clip(String(p.message ?? "").replace(/\s+/g, " "), 100)}"`
            : `report   ${p.found ? `${p.routeId ?? "no routeId"}, ${p.distanceKm} km, ${p.ridingMinutes} min, open ${p.openRoadPct}%, 50z ${p.pct50}%` : "nothing found"}: ${clip(String(p.verdict ?? ""), 100)}`;
        break;
      case "error":
        text = `ERROR    ${clip(String(p), 160)}`;
        break;
      default:
        text = `${e.kind} ${e.name}`;
    }
    lines.push(`${when}  ${scope}  ${text}`);
    if (full) lines.push(JSON.stringify(e.payload, null, 1).split("\n").map((l) => `${" ".repeat(scopeWidth + 11)}${l}`).join("\n"));
  }

  const scouts = new Set(events.filter((e) => e.scope.startsWith("scout:")).map((e) => e.scope)).size;
  lines.push("", `Usage: ${formatUsage(run.usage)}`);
  if (scouts) lines.push(`Scouts: ${scouts}`);
  for (const [name, stat] of [...toolStats.entries()].sort((a, b) => b[1].ms - a[1].ms)) {
    lines.push(`  ${name.padEnd(15)} ${String(stat.calls).padStart(3)} calls  ${secs(stat.ms).padStart(7)} total${stat.failed ? `  ${stat.failed} failed` : ""}`);
  }
  if (run.error) lines.push(`Ended with error: ${run.error}`);
  return lines.join("\n");
}
