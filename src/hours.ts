/**
 * Minimal reader of OpenStreetMap opening_hours, enough for shops and cafés:
 *   "24/7", "Mo-Fr 08:00-18:00; Sa 09:00-12:00", "Mo,We,Fr-Sa 06:00-17:00",
 *   "Mo off", "Su 06:30-12:00", "08:00-12:00,16:00-19:00" (every day),
 *   "Th-Su" (days only: open those days, at hours not given; closed the others).
 * Anything it cannot read yields "unknown", never a wrong "open".
 */
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export type OpenState = "open" | "closed" | "unknown";

function dayIndex(date: string): number {
  // JS: Sunday = 0; OSM: Monday first.
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function expandDays(spec: string): number[] | null {
  const days = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.trim();
    if (!range) continue;
    const [from, to] = range.split("-").map((d) => DAYS.indexOf(d.trim()));
    if (from === undefined || from < 0) return null;
    if (to === undefined) days.add(from);
    else {
      if (to < 0) return null;
      for (let d = from; ; d = (d + 1) % 7) {
        days.add(d);
        if (d === to) break;
      }
    }
  }
  return [...days];
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Whether a place is open at a local time on a date, from its opening_hours tag. */
export function isOpenAt(openingHours: string | null | undefined, date: string, time: string): OpenState {
  if (!openingHours) return "unknown";
  const text = openingHours.trim();
  if (text === "24/7") return "open";
  const day = dayIndex(date);
  const minutes = toMinutes(time);
  let state: OpenState = "unknown";
  let matchedAnyRule = false;

  for (const rawRule of text.split(";")) {
    const rule = rawRule.trim();
    if (!rule || /^PH\b|^SH\b/.test(rule)) continue; // public and school holidays: ignored
    const m =
      /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?\s*)+)?\s*(off|closed|(?:\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\s*)?)+)?$/.exec(
        rule,
      );
    if (!m || (!m[1] && !m[2])) return "unknown"; // a rule we cannot read: say nothing rather than mislead
    const days = m[1] ? expandDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return "unknown";
    if (!days.includes(day)) continue;
    matchedAnyRule = true;
    const body = m[2];
    // Days without hours: open that day, but at what time is not said.
    if (body === undefined) {
      state = "unknown";
      continue;
    }
    if (body === "off" || body === "closed") {
      state = "closed";
      continue;
    }
    const ranges = body.split(",").map((r) => r.trim().split("-").map(toMinutes) as [number, number]);
    const open = ranges.some(([from, to]) =>
      to > from ? minutes >= from && minutes < to : minutes >= from || minutes < to,
    );
    // Later rules for the same day override earlier ones, as in OSM.
    state = open ? "open" : "closed";
  }
  return matchedAnyRule ? state : "closed";
}
