import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SavedRide } from "./store.ts";
import { formatUsage } from "./usage.ts";

const EXPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "exports");

const fmtMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
const avg = (km: number, minutes: number) => (minutes > 0 ? Math.round(km / (minutes / 60)) : 0);
const cell = (text: string) => text.replace(/\|/g, "\\|");
const stars = (rating: number | null) => (rating === null ? "unrated" : `${rating}/5`);

/** Cameras a few metres apart (one per direction) shown once, with a count. */
function mergeCameras(cameras: NonNullable<SavedRide["extras"]>["cameras"]) {
  const merged: Array<{ km: number; leg: number; limit: string; count: number }> = [];
  for (const c of cameras) {
    const limit = c.limitKmh === null ? "not tagged" : String(c.limitKmh);
    const last = merged.at(-1);
    if (last && Math.abs(last.km - c.kmAlongRoute) <= 0.1 && last.limit === limit) last.count++;
    else merged.push({ km: c.kmAlongRoute, leg: c.leg, limit, count: 1 });
  }
  return merged;
}

/**
 * A ride as a Markdown document: everything stored about it, in a fixed
 * layout, fit for versioning next to the GPX file.
 */
export function formatRideMarkdown(ride: SavedRide): string {
  const s = (ride.speedLimits ?? {}) as {
    openRoadPct?: number;
    untaggedOpenRoad?: { pct: number };
    timeOnRoads70PlusPct?: number;
    timeAbove70EstimatedPct?: number;
    limit31to50?: { pct: number };
    limit30OrLess?: { pct: number };
    motorwayKm?: number;
  };
  const x = ride.extras;
  const lines: string[] = [];
  const push = (...items: string[]) => lines.push(...items);

  push(`# Ride #${ride.id}: ${ride.name}${ride.parentId ? ` (from #${ride.parentId})` : ""}`, "");
  push(`**${ride.distanceKm} km | ${fmtMinutes(ride.ridingMinutes)} riding | ${avg(ride.distanceKm, ride.ridingMinutes)} km/h average | ${stars(ride.rating)}**`, "");
  push(`Ride date ${ride.rideDate ?? "not set"}, departure ${ride.departure ?? "not set"}, from ${ride.home}. Saved ${ride.createdAt.slice(0, 10)}.`, "");
  if (ride.notes) push(`> ${ride.notes}`, "");
  push(`Request: ${ride.request}`, "", `Map: <${ride.mapsUrl}>`, "");

  push("## Figures", "");
  push(`- Riding time: ${fmtMinutes(ride.ridingMinutes)} (${ride.ridingMinutes} min), estimated from speed limits and bends, no stops, no traffic.`);
  push(`- Motorways: ${ride.preferences.avoidMotorways ? "excluded" : "permitted"}${s.motorwayKm !== undefined ? `, ${s.motorwayKm} km used` : ""}.`);
  push(`- Targets: at most ${ride.preferences.max30Pct}% in zones of 30 or less, at most ${ride.preferences.max50Pct}% in 31-50 zones.`, "");

  if (s.limit31to50) {
    push("## Road mix", "");
    push(`- Open road: ${s.openRoadPct ?? "?"}%${s.untaggedOpenRoad ? ` (${s.untaggedOpenRoad.pct}% with no tagged limit, legal default assumed)` : ""}`);
    if (s.timeOnRoads70PlusPct !== undefined) push(`- Time on roads limited to 70 or more: ${s.timeOnRoads70PlusPct}% (${s.timeAbove70EstimatedPct}% at an estimated 70 or more)`);
    push(`- 31-50 zones: ${s.limit31to50.pct}%`, `- Zones of 30 or less: ${s.limit30OrLess?.pct ?? "?"}%`, "");
  }

  push("## Legs", "", "| # | From | To | km | Time | Avg | Main roads | Rating |", "|---|---|---|---|---|---|---|---|");
  for (const leg of ride.legs) {
    const rating = leg.rating === null ? "" : `${leg.rating}/5${leg.notes ? ` (${leg.notes})` : ""}`;
    push(`| ${leg.seq} | ${cell(leg.from)} | ${cell(leg.to)} | ${leg.distanceKm} | ${fmtMinutes(leg.ridingMinutes)} | ${avg(leg.distanceKm, leg.ridingMinutes)} | ${cell(leg.mainRoads.join(", "))} | ${cell(rating)} |`);
  }
  push(`| | **Total** | | **${ride.distanceKm}** | **${fmtMinutes(ride.ridingMinutes)}** | **${avg(ride.distanceKm, ride.ridingMinutes)}** | | |`, "");

  if (x?.daylight) {
    push(`## Daylight (${ride.rideDate})`, "", `Sunrise ${x.daylight.sunrise}, sunset ${x.daylight.sunset}. Usable light ${x.daylight.firstLight} to ${x.daylight.lastLight} (${x.daylight.daylightHours} h).`, "");
  }

  if (x) {
    const cameras = mergeCameras(x.cameras);
    push(`## Fixed cameras (${x.cameras.length})`, "");
    if (cameras.length === 0) push("None mapped on the route. Fixed cameras from OpenStreetMap only; mobile controls are not covered.", "");
    else {
      push("| km | Leg | Limit |", "|---|---|---|");
      for (const c of cameras) push(`| ${c.km}${c.count > 1 ? ` (x${c.count})` : ""} | ${c.leg} | ${c.limit} |`);
      push("", "Fixed cameras from OpenStreetMap only; mobile controls are not covered. A doubled entry is one device per direction.", "");
    }
    for (const [kind, stops] of Object.entries(x.stops)) {
      if (stops.length === 0) continue;
      push(`## ${kind[0]!.toUpperCase()}${kind.slice(1)} stops`, "");
      for (const st of stops) push(`- ${cell(st.name)}: km ${st.kmAlongRoute}, leg ${st.leg}${st.detourM > 100 ? `, ${st.detourM} m off the route` : ""}${st.openingHours ? `, ${cell(st.openingHours)}` : ""}`);
      push("");
    }
    for (const [name, reason] of Object.entries(x.errors ?? {})) push(`_${name}: last lookup failed (${reason.split(".")[0]})._`, "");
  } else {
    push("_Daylight, cameras and stops not gathered yet: `npm run rides -- refresh " + ride.id + "`._", "");
  }

  if (ride.usage) push("## Planning metadata", "", formatUsage(ride.usage), "");
  push("## Itinerary as planned", "", "The text the planner wrote when the ride was saved; figures above are the current ones.", "", "```", ride.itinerary, "```", "");
  push(`---`, `Exported by agentRide on ${new Date().toISOString().slice(0, 10)}. Waypoints: ${ride.waypoints.join(" → ")}${ride.roundTrip ? " → back to start" : ""}.`);
  return lines.join("\n");
}

/** Write the Markdown document, by default into exports/ in the project. Returns the absolute path. */
export function writeRideMarkdown(ride: SavedRide, file?: string): string {
  const slug = ride.name
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const path = resolve(file?.trim() || resolve(EXPORT_DIR, `${ride.id}-${slug || "ride"}.md`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatRideMarkdown(ride));
  return path;
}
