// Deleting, cancelling and tidying the library: the questions asked before a
// delete and the reports after, shared by the terminal and the MCP server.
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseRideDay } from "./planRide.ts";
import type { SavedRide, Store } from "./store.ts";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export function roadbookOf(store: Store, roadbook: string): SavedRide {
  const saved = store.findRide(roadbook);
  if (!saved) throw new Error(`No roadbook matches "${roadbook}". List them with roadbooks.`);
  return saved;
}

/** "Delete roadbook #7 "Avesnois loop", its 3 rides and 2 notes? Its 4 road ratings stay: ..." */
export function deleteRoadbookQuestion(store: Store, saved: SavedRide): string {
  const { rides, notes, roadRatings } = store.roadbookImpact(saved.id);
  const goes = [rides ? plural(rides, "ride") : "", notes ? plural(notes, "note") : ""].filter(Boolean);
  const stays = roadRatings
    ? ` Its ${plural(roadRatings, "road rating")} stay${roadRatings === 1 ? "s" : ""}: they are about the roads and keep steering plans.`
    : "";
  return `Delete roadbook #${saved.id} "${saved.name}"${goes.length ? `, its ${goes.join(" and ")}` : ""}?${stays}`;
}

/** The ride of a roadbook on a day in the rider's words (2026-10-10, 10/10, saturday, today). */
export function rideOnDay(store: Store, roadbook: string, day: string) {
  const saved = roadbookOf(store, roadbook);
  const date = parseRideDay(day);
  if (!date) throw new Error(`"${day}" is not a day: give YYYY-MM-DD, 10/10, today, tomorrow or a weekday.`);
  const ride = store.findRideOn(saved.id, date);
  if (!ride)
    throw new Error(`Roadbook #${saved.id} "${saved.name}" has no ride on ${date}. Its rides: list them with rides.`);
  return { saved, date, ride };
}

export function deleteRideQuestion(found: ReturnType<typeof rideOnDay>): string {
  const { saved, date, ride } = found;
  const notes = ride.notes
    ? ` Its ${plural(ride.notes, "note")} stay${ride.notes === 1 ? "s" : ""} on the roadbook.`
    : "";
  return `Delete the ride of ${date} (${ride.status}) from roadbook #${saved.id} "${saved.name}"?${notes} The roadbook stays.`;
}

/** Other files next to the library: migration backups, old libraries. Listed, never deleted. */
export function leftoverFiles(libraryPath: string): Array<{ name: string; bytes: number }> {
  if (libraryPath === ":memory:") return [];
  const own = new Set(["", "-wal", "-shm"].map((suffix) => basename(libraryPath) + suffix));
  const dir = dirname(libraryPath);
  return readdirSync(dir)
    .filter((name) => !own.has(name) && /\.db/.test(name) && statSync(join(dir, name)).isFile())
    .map((name) => ({ name, bytes: statSync(join(dir, name)).size }))
    .sort((a, b) => b.bytes - a.bytes);
}

export function tidyLibrary(store: Store): string {
  const { expired, beforeBytes, afterBytes } = store.tidy();
  const lines = [
    `Removed ${plural(expired, "expired lookup")} from the cache; traces and everything saved are kept.`,
    `Library: ${mb(beforeBytes)} before, ${mb(afterBytes)} now (${store.path}).`,
  ];
  const leftovers = leftoverFiles(store.path);
  if (leftovers.length) {
    lines.push(
      "",
      `Other files next to it, not touched (migration backups and old libraries; delete them yourself once all is well):`,
      ...leftovers.map((f) => `  ${mb(f.bytes).padStart(8)}  ${f.name}`),
    );
  }
  return lines.join("\n");
}
