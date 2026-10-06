import { rideBriefing } from "./briefing.ts";
import { enrichRide, rideNavigation } from "./library.ts";
import type { Store } from "./store.ts";

const pad = (n: number) => String(n).padStart(2, "0");
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  dimanche: 0,
  monday: 1,
  mon: 1,
  lundi: 1,
  tuesday: 2,
  tue: 2,
  mardi: 2,
  wednesday: 3,
  wed: 3,
  mercredi: 3,
  thursday: 4,
  thu: 4,
  jeudi: 4,
  friday: 5,
  fri: 5,
  vendredi: 5,
  saturday: 6,
  sat: 6,
  samedi: 6,
};

/**
 * A day in the rider's words, as YYYY-MM-DD: an ISO date, 17/10 or 17/10/2026,
 * today, tomorrow, or a weekday (the next one; today's weekday means a week on,
 * "this saturday" on a Saturday means today). Null when it is not a day.
 */
export function parseRideDay(text: string, now = new Date()): string | null {
  const words = text.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(words)) return words;
  const short = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(words);
  if (short) {
    const [day, month] = [Number(short[1]), Number(short[2])];
    let year = short[3] ? Number(short[3]) : now.getFullYear();
    // Without a year, a date already gone this year is next year's.
    if (!short[3] && localDay(new Date(year, month - 1, day)) < localDay(now)) year++;
    const date = new Date(year, month - 1, day);
    return date.getMonth() === month - 1 ? localDay(date) : null;
  }
  const at = (offset: number) => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  if (["today", "aujourd'hui"].includes(words)) return at(0);
  if (["tomorrow", "demain"].includes(words)) return at(1);
  const weekday = /^(?:(this|next|ce|prochain)\s+)?([a-z]+)(?:\s+prochain)?$/.exec(words);
  const target = weekday ? WEEKDAYS[weekday[2]!] : undefined;
  if (target === undefined) return null;
  const ahead = (target - now.getDay() + 7) % 7;
  return at(ahead === 0 && weekday![1] !== "this" && weekday![1] !== "ce" ? 7 : ahead);
}

/** A departure time in the rider's words, as HH:MM: 9, 9:30, 09:30, 9h, 9h30, 9am, 2pm. Null otherwise. */
export function parseDeparture(text: string): string | null {
  const m = /^(\d{1,2})(?:[:h](\d{2})?)?\s*(am|pm)?$/.exec(text.trim().toLowerCase());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : null;
}

const FILLER = new Set(["on", "at", "for", "the", "le", "à", "a", "leaving", "leave", "departure", "depart", "start"]);

/**
 * "plan a ride from roadbook 7 on Saturday at 9", "plan roadbook 7 tomorrow",
 * or, with a roadbook already in view, "plan a ride on Saturday at 9:00".
 * Only a day and a time may follow; anything else ("50 km longer") is a change
 * for the planner, so this returns null and the model takes it.
 */
export function parsePlanRide(
  sentence: string,
  now = new Date(),
): { roadbook: string | null; date: string; departure: string | null } | null {
  const m =
    /^\s*(?:plan|schedule)\s+(?:(?:a\s+|another\s+|the\s+)?ride\s*)?(?:(?:from|of|with|on|for)\s+)?(?:roadbook\s+#?(\d+)\s*)?(.*)$/i.exec(
      sentence,
    );
  if (!m) return null;
  const roadbook = m[1] ?? null;
  const words = m[2]!
    .replace(/[.,!?]+$/, "")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase()));
  // The day may be two words ("next saturday"); the time, if any, comes last.
  let departure: string | null = null;
  const last = words.at(-1);
  if (words.length > 1 && last && parseDeparture(last)) {
    departure = parseDeparture(last);
    words.pop();
  }
  const date = parseRideDay(words.join(" "), now);
  return date ? { roadbook, date, departure } : null;
}

/**
 * Plan a ride from a saved roadbook on a date: a ride added to it (or the one
 * already on that date, updated), no copy of the design. Gathers the day's
 * data (daylight, forecast, conditions, stop plan), then the briefing and the
 * navigation links. No model call.
 */
export async function planRideFrom(
  store: Store,
  roadbook: string,
  date: string,
  departure: string | null,
  now = new Date(),
): Promise<string> {
  const today = localDay(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`"${date}" is not a date (YYYY-MM-DD).`);
  if (date < today) throw new Error(`${date} is in the past; pick today or a later day.`);
  if (departure !== null && !parseDeparture(departure)) throw new Error(`"${departure}" is not a time (HH:MM).`);
  const saved = store.findRide(roadbook);
  if (!saved) throw new Error(`No roadbook matches "${roadbook}". List them with roadbooks.`);
  const leaving = departure ? parseDeparture(departure)! : (saved.departure ?? "09:00");
  const { dayId, created } = store.planDay(saved.id, date, leaving);
  const day = store.rideView(saved.id, dayId)!;
  await enrichRide(store, day);
  const ready = store.rideView(saved.id, dayId)!;
  const briefing = await rideBriefing(store, ready, today);
  const nav = rideNavigation(ready);
  return [
    `${created ? "Ride planned" : "Ride updated"} from roadbook #${saved.id} "${saved.name}" on ${date}, leaving at ${leaving}. The roadbook is unchanged.`,
    "",
    briefing,
    "",
    "Navigation (with the stops):",
    ...nav.links.map((link, i) => `  ${nav.links.length > 1 ? `part ${i + 1}: ` : ""}${link}`),
    ...(nav.overview ? [`  whole ride (overview, not for navigation): ${nav.overview}`] : []),
  ].join("\n");
}
