// Ride feedback: notes left during a ride, placed afterwards on the road
// actually ridden (from a recorded track) or on the plan (from elapsed time),
// then confirmed by the rider as road ratings that steer future planning.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { cellOfPoint, decodePolyline, type LatLon, pointCells, widenCells } from "./geometry.ts";
import type { NotePlacement, RideNote, SavedRide, Store } from "./store.ts";
import { describeCoords, haversineKm } from "./tools/geo.ts";
import { roadsAlong } from "./tools/trip.ts";
import { utcOffsetSecondsOn } from "./tools/weather.ts";

/** A note covers the minutes before it was left, ten unless the rider says otherwise. */
export const DEFAULT_MINUTES_BACK = 10;
/** Off-plan stretches shorter than this are GPS noise or a fuel stop, not a detour. */
export const DETOUR_MIN_KM = 2;

export interface TrackPoint extends LatLon {
  /** Epoch milliseconds. */
  time: number;
}

const round1 = (n: number) => Number(n.toFixed(1));
const systemTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Clock time of an instant in a timezone, "10:42". */
export function clockAt(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(ms)
    .replace(/^24/, "00");
}

/** Calendar day of an instant in a timezone, "2026-10-04". */
const dayAt = (ms: number, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(ms);

const duration = (minutes: number) =>
  minutes < 60
    ? `${Math.round(minutes)} min`
    : `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, "0")}`;

/** Time-stamped points of a recorded track, in time order. Any recording app's GPX export will do. */
export function parseGpxTrack(xml: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const match of xml.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const [, attrs = "", body = ""] = match;
    const lat = Number(/\blat="([^"]+)"/.exec(attrs)?.[1]);
    const lon = Number(/\blon="([^"]+)"/.exec(attrs)?.[1]);
    const time = Date.parse(/<time>([^<]+)<\/time>/.exec(body)?.[1] ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(time)) points.push({ lat, lon, time });
  }
  if (points.length < 2) {
    throw new Error(
      "No time-stamped track points (<trkpt> with <time>) in this GPX: export the recorded track, not a planned route.",
    );
  }
  return points.sort((a, b) => a.time - b.time);
}

/** Read a recorded track from a file on this machine; "~/" is the home folder. */
export function readTrack(path: string): TrackPoint[] {
  return parseGpxTrack(readFileSync(path.replace(/^~(?=\/)/, homedir()), "utf8"));
}

/** The ride a note belongs to: the one named, else the ride dated today, else the last saved. */
export function rideForNote(store: Store, ride: string | undefined, today: string): SavedRide {
  if (ride) {
    const found = store.findRide(ride);
    if (!found) throw new Error(`No saved ride matches "${ride}".`);
    return found;
  }
  const rides = store.listRides();
  const found = rides.findLast((r) => r.rideDate === today) ?? rides.at(-1);
  if (!found) throw new Error("No saved ride to attach the note to: save the ride first.");
  return found;
}

/** The ride to review: the one named, else the ride of the latest pending note. */
export function rideToReview(store: Store, ride: string | undefined): SavedRide {
  if (ride) {
    const found = store.findRide(ride);
    if (!found) throw new Error(`No saved ride matches "${ride}".`);
    return found;
  }
  const last = store.listNotes().at(-1);
  if (!last) throw new Error("No notes waiting for review. Name a ride to review its track anyway.");
  return store.findRide(String(last.rideId))!;
}

/** Leave a note on a ride, timed now: "last 10 min awesome", "cobbles, never again". */
export function addRideNote(
  store: Store,
  input: { ride?: string; text: string; rating?: number | null; minutesBack?: number; at?: Date },
): { note: RideNote; ride: SavedRide } {
  const at = input.at ?? new Date();
  const ride = rideForNote(store, input.ride, dayAt(at.getTime(), systemTimezone()));
  const rating = input.rating ?? null;
  if (rating !== null && !(Number.isInteger(rating) && rating >= 0 && rating <= 5)) {
    throw new Error("A rating is a whole number from 0 (never again) to 5 (loved).");
  }
  const note = store.addNote({
    rideId: ride.id,
    text: input.text.trim(),
    rating,
    minutesBack: input.minutesBack ?? DEFAULT_MINUTES_BACK,
    at,
  });
  return { note, ride };
}

const NEVER = /never again|jamais|avoid|horrible|terrible|awful|dangerous|nightmare|worst/i;
const LOVED = /awesome|amazing|superb|fantastic|brilliant|perfect|\bbest\b|loved|incredible|génial|magnifique/i;
const POOR = /\b(bad|boring|dull|rough|bumpy|potholes?|gravel|cobbles?|setts|traffic)\b/i;
const GOOD = /\b(great|good|nice|lovely|fun|enjoy\w*)\b/i;

/** The note's own rating, else one read from its words; null when the words do not say. */
export function proposedRating(note: Pick<RideNote, "rating" | "text">): number | null {
  if (note.rating !== null) return note.rating;
  if (NEVER.test(note.text)) return 0;
  if (LOVED.test(note.text)) return 5;
  if (POOR.test(note.text)) return 1;
  if (GOOD.test(note.text)) return 4;
  return null;
}

const lengthKm = (points: LatLon[]) => points.reduce((km, p, i) => (i ? km + haversineKm(points[i - 1]!, p) : 0), 0);

/** Name, ends and cells of a stretch of road. Map matching failures are reported in the name, not thrown. */
async function placeStretch(
  points: LatLon[],
  window: string,
  approximate: boolean,
  note: RideNote,
): Promise<NotePlacement> {
  let road: string;
  try {
    road =
      (await roadsAlong(points))
        .slice(0, 2)
        .map((r) => r.name)
        .join(" / ") || "unnamed roads";
  } catch (error) {
    road = `roads not identified (${error instanceof Error ? error.message : String(error)})`;
  }
  const from = await describeCoords(points[0]!.lat, points[0]!.lon);
  const to = await describeCoords(points.at(-1)!.lat, points.at(-1)!.lon);
  return {
    road,
    from,
    to,
    window,
    km: round1(lengthKm(points)),
    cells: pointCells(points),
    approximate,
    proposedRating: proposedRating(note),
  };
}

/** The planned line with the distance along it at each point. */
function planLine(ride: SavedRide): Array<LatLon & { km: number }> {
  const line: Array<LatLon & { km: number }> = [];
  for (const shape of ride.shapes ?? []) {
    for (const p of decodePolyline(shape)) {
      const last = line.at(-1);
      line.push({ ...p, km: last ? last.km + haversineKm(last, p) : 0 });
    }
  }
  return line;
}

/** Departure as an instant: the ride's date (else the note's day) and time, in the rider's timezone. */
function departureMs(ride: SavedRide, fallbackDay: string, timezone: string): number | null {
  if (!ride.departure) return null;
  const date = ride.rideDate ?? fallbackDay;
  const [h = 0, m = 0] = ride.departure.split(":").map(Number);
  return Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60_000 - utcOffsetSecondsOn(timezone, date) * 1000;
}

export interface Detour {
  from: string;
  to: string;
  road: string;
  km: number;
  window: string;
}

export interface RideReview {
  ride: { id: number; name: string };
  track: {
    points: number;
    km: number;
    movingMinutes: number;
    movingAvgKmh: number;
    plannedKm: number;
    plannedMinutes: number;
    plannedAvgKmh: number;
  } | null;
  notes: Array<{ note: RideNote; placement: NotePlacement | null; problem: string | null }>;
  detours: Detour[];
}

/** Moving time leaves out stops: intervals under 5 km/h, and gaps of more than five minutes. */
function pace(track: TrackPoint[]) {
  let km = 0;
  let movingSeconds = 0;
  for (let i = 1; i < track.length; i++) {
    const d = haversineKm(track[i - 1]!, track[i]!);
    const dt = (track[i]!.time - track[i - 1]!.time) / 1000;
    km += d;
    if (dt > 0 && dt <= 300 && (d / dt) * 3600 >= 5) movingSeconds += dt;
  }
  return { km, movingMinutes: movingSeconds / 60 };
}

/** Stretches of the track away from the planned roads for DETOUR_MIN_KM or more. */
async function findDetours(track: TrackPoint[], ride: SavedRide, timezone: string): Promise<Detour[]> {
  const planned = widenCells(ride.cells);
  const runs: TrackPoint[][] = [];
  let run: TrackPoint[] = [];
  for (const p of track) {
    if (planned.has(cellOfPoint(p))) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) runs.push(run);
  const detours: Detour[] = [];
  for (const points of runs) {
    const km = lengthKm(points);
    if (km < DETOUR_MIN_KM) continue;
    const stretch = await placeStretch(
      points,
      `${clockAt(points[0]!.time, timezone)}-${clockAt(points.at(-1)!.time, timezone)}`,
      false,
      { rating: null, text: "" } as RideNote,
    );
    detours.push({ from: stretch.from, to: stretch.to, road: stretch.road, km: stretch.km, window: stretch.window });
  }
  return detours;
}

/**
 * Place every pending note of a ride: on the recorded track when one is given
 * and covers the note's time, else on the plan by elapsed time (approximate).
 * Placements are stored on the notes, to be confirmed with applyReview.
 */
export async function reviewRide(
  store: Store,
  ride: SavedRide,
  options: { track?: TrackPoint[]; timezone?: string } = {},
): Promise<RideReview> {
  const timezone = options.timezone ?? systemTimezone();
  const { track } = options;
  const notes = store.listNotes({ rideId: ride.id });
  // Each note is placed on the route of the ride it was left on: after a change to
  // the roadbook, an earlier ride keeps the version it rode.
  const plans = new Map<number | null, { plan: SavedRide; line: ReturnType<typeof planLine> }>();
  const planOf = (dayId: number | null) => {
    if (!plans.has(dayId)) {
      const plan = (dayId !== null && store.rideView(ride.id, dayId)) || ride;
      plans.set(dayId, { plan, line: planLine(plan) });
    }
    return plans.get(dayId)!;
  };
  const review: RideReview = { ride: { id: ride.id, name: ride.name }, track: null, notes: [], detours: [] };

  if (track) {
    const { km, movingMinutes } = pace(track);
    review.track = {
      points: track.length,
      km: round1(km),
      movingMinutes: Math.round(movingMinutes),
      movingAvgKmh: movingMinutes ? Math.round(km / (movingMinutes / 60)) : 0,
      plannedKm: ride.distanceKm,
      plannedMinutes: ride.ridingMinutes,
      plannedAvgKmh: Math.round(ride.distanceKm / (ride.ridingMinutes / 60)),
    };
    // The track is compared with the route of the ride of its day, when there is one.
    const day = dayAt(track[0]!.time, timezone);
    const ridden = store.findRideOn(ride.id, day);
    review.detours = await findDetours(track, ridden ? planOf(ridden.id).plan : ride, timezone);
  }

  for (const note of notes) {
    const end = Date.parse(note.createdAt);
    const start = end - note.minutesBack * 60_000;
    const window = `${clockAt(start, timezone)}-${clockAt(end, timezone)}`;
    let placement: NotePlacement | null = null;
    let problem: string | null = null;

    const ridden = track?.filter((p) => p.time >= start && p.time <= end) ?? [];
    if (ridden.length >= 2) {
      placement = await placeStretch(ridden, window, false, note);
    } else {
      const { plan, line } = planOf(note.dayId);
      const departure = departureMs(plan, dayAt(end, timezone), timezone);
      if (!line.length) problem = "the ride has no stored route line; refresh it, or give the recorded track";
      else if (departure === null) problem = "the ride has no departure time; give the recorded track";
      else {
        // The plan's pace, without stops: notes late in the day land a little too far along.
        const kmAt = (ms: number) =>
          Math.min(Math.max(((ms - departure) / 60_000 / plan.ridingMinutes) * line.at(-1)!.km, 0), line.at(-1)!.km);
        const [a, b] = [kmAt(start), kmAt(end)];
        const stretch = line.filter((p) => p.km >= a && p.km <= b);
        if (stretch.length < 2) problem = `${window} falls outside the planned riding time`;
        else placement = await placeStretch(stretch, window, true, note);
      }
      if (track && placement) problem = "the recorded track does not cover this time; placed on the plan";
    }
    store.setNotePlacement(note.id, placement);
    review.notes.push({ note: { ...note, placement }, placement, problem });
  }
  return review;
}

export interface ReviewDecision {
  noteId: number;
  /** 0-5; omitted keeps the proposed rating. */
  rating?: number | null;
  /** Drop the note without rating any road. */
  dismiss?: boolean;
}

/** Turn confirmed notes into road ratings. Returns one line per decision. */
export function applyReview(store: Store, decisions: ReviewDecision[]): string[] {
  const notes = new Map(store.listNotes({ all: true }).map((n) => [n.id, n]));
  return decisions.map((decision) => {
    const note = notes.get(decision.noteId);
    if (!note || note.status !== "pending") return `Note #${decision.noteId}: not a pending note, skipped.`;
    if (decision.dismiss) {
      store.setNoteStatus(note.id, "dismissed");
      return `Note #${note.id} dismissed.`;
    }
    const placement = note.placement;
    if (!placement) return `Note #${note.id}: not placed yet, review the ride first.`;
    const rating = decision.rating ?? placement.proposedRating;
    if (rating === null || !(Number.isInteger(rating) && rating >= 0 && rating <= 5)) {
      return `Note #${note.id}: needs a rating from 0 to 5, skipped.`;
    }
    store.addRoadRating({
      rideId: note.rideId,
      noteId: note.id,
      road: `${placement.road}, ${placement.from} to ${placement.to}`,
      rating,
      reason: note.text,
      approximate: placement.approximate,
      cells: placement.cells,
    });
    store.setNoteStatus(note.id, "reviewed");
    return `Rated ${rating}: ${placement.road}, ${placement.from} to ${placement.to}${placement.approximate ? " (approximate)" : ""}.`;
  });
}

/** The review as the rider reads it, in any mode. */
export function formatReview(review: RideReview): string {
  const lines = [`Review of roadbook #${review.ride.id} "${review.ride.name}"`];
  const t = review.track;
  if (t) {
    lines.push(
      `Ridden: ${t.km} km, ${duration(t.movingMinutes)} moving, ${t.movingAvgKmh} km/h on average (${t.points} track points).`,
      `Planned: ${t.plannedKm} km, ${duration(t.plannedMinutes)}, ${t.plannedAvgKmh} km/h.`,
    );
    lines.push(
      review.detours.length
        ? `Detours from the plan (${DETOUR_MIN_KM} km or more):`
        : "No detours: the track follows the plan.",
    );
    for (const d of review.detours) lines.push(`  ${d.window}  ${d.road}, ${d.from} to ${d.to}, ${d.km} km`);
  } else {
    lines.push("No recorded track: notes are placed on the plan by elapsed time (approximate).");
  }
  if (!review.notes.length) lines.push("No notes waiting for review on this ride.");
  else lines.push("Notes:");
  for (const { note, placement, problem } of review.notes) {
    lines.push(`  #${note.id}  ${placement?.window ?? ""}  "${note.text}"`);
    if (placement) {
      const rating =
        placement.proposedRating === null
          ? "no rating proposed, give one"
          : `proposed rating ${placement.proposedRating}`;
      lines.push(
        `      ${placement.road}, ${placement.from} to ${placement.to}, ${placement.km} km${placement.approximate ? " (approximate)" : ""}: ${rating}`,
      );
    }
    if (problem) lines.push(`      ${placement ? "note" : "not placed"}: ${problem}`);
  }
  return lines.join("\n");
}

/** One line about notes waiting for review, or null when there are none. */
export function pendingNotesSummary(store: Store): string | null {
  const pending = store.listNotes();
  if (!pending.length) return null;
  const rides = [...new Set(pending.map((n) => `#${n.rideId}`))];
  return `${pending.length} ride note${pending.length > 1 ? "s" : ""} waiting for review (roadbook ${rides.join(", ")})`;
}
