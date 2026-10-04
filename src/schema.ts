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
