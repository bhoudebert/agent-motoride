import { z } from "zod";

/** Shape of every final answer from the planner. */
export const RideAnswer = z.object({
  message: z
    .string()
    .describe(
      "Everything to show the rider, as plain text for a terminal: the itinerary, or the answer to a question.",
    ),
  ride: z
    .object({
      routeId: z.string().describe("routeId returned by calculateTrip for the exact routed trip the message presents"),
      rideDate: z.string().nullable().describe("Ride day as YYYY-MM-DD, or null if not set"),
      departure: z.string().nullable().describe("Departure time as HH:MM, or null if not set"),
      name: z.string().describe("A few words a rider would recognise the ride by"),
    })
    .nullable()
    .describe(
      "The routed trip the message presents as the itinerary. Null when the message is an answer without a new itinerary.",
    ),
});
export type RideAnswer = z.infer<typeof RideAnswer>;

/**
 * The API validates the answer against the schema, so this normally just
 * parses. A model that does not enforce structured output (a local one, behind
 * a compatible endpoint) tends to wrap the JSON in a code fence or a line of
 * prose, and to give `ride` as a single string; both are read here, and the
 * route id is still checked against the session by the caller. Should the
 * answer be prose anyway, show the prose rather than fail the turn.
 */
export function parseAnswer(raw: string): RideAnswer {
  return readAnswer(raw) ?? { message: raw, ride: null };
}

/** The answer in any of the forms above, or null when the text is not one. */
export function readAnswer(raw: string): RideAnswer | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const open = raw.indexOf("{");
  const close = raw.lastIndexOf("}");
  const candidates = [raw, fenced, open >= 0 && close > open ? raw.slice(open, close + 1) : undefined];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = RideAnswer.safeParse(coerceRide(JSON.parse(candidate.trim())));
      if (parsed.success) return parsed.data;
    } catch {
      // Not JSON: try the next reading.
    }
  }
  return null;
}

/** `ride` as "r2_2026-10-17_Winding_Loop" becomes the object the schema asks for. */
function coerceRide(value: unknown): unknown {
  if (!value || typeof value !== "object" || typeof (value as { ride?: unknown }).ride !== "string") return value;
  const [routeId = "", ...rest] = ((value as { ride: string }).ride as string).split("_");
  const rideDate = rest.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) ?? null;
  const name = rest.filter((part) => part !== rideDate).join(" ") || routeId;
  return { ...value, ride: { routeId, rideDate, departure: null, name } };
}

/** What a scout reports back about one area. */
export const ScoutReport = z.object({
  area: z.string(),
  found: z.boolean().describe("True when a loop satisfying the constraints was routed"),
  routeId: z.string().nullable().describe("routeId of the best routed loop, from calculateTrip"),
  waypoints: z.array(z.string()).describe("Waypoints of that loop in order, as given to calculateTrip"),
  distanceKm: z.number().nullable(),
  ridingMinutes: z.number().nullable(),
  openRoadPct: z.number().nullable(),
  pct50: z.number().nullable().describe("Share of distance in 31-50 km/h zones"),
  pct30: z.number().nullable().describe("Share of distance in zones of 30 km/h or less"),
  weather: z
    .string()
    .describe("Forecast along the loop for the riding hours, in one or two sentences, from getWeather"),
  verdict: z
    .string()
    .describe("Why this loop is worth riding or not, and what rules the area out if nothing was found"),
});
export type ScoutReport = z.infer<typeof ScoutReport>;
