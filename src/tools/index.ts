import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { registerRoute, savedRideOverlap, type RideContext } from "../session.ts";
import { fmtCoords, haversineKm, resolvePoint } from "./geo.ts";
import { searchRoads } from "./roads.ts";
import { getTraffic } from "./traffic.ts";
import { computeTrip, type CalculateTripInput, type TripComputation } from "./trip.ts";
import { getWeather } from "./weather.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Roads rarely change; routes can (closures, map edits); forecasts move by the hour.
const TTL = { searchRoads: 30 * DAY, calculateTrip: 7 * DAY, getWeather: HOUR };

/** JSON with sorted keys, so equal inputs always give the same cache key. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const location = z
  .string()
  .describe('Place name ("Florac", "Vannes, France") or "lat,lon" coordinates');
const waypoints = z
  .array(location)
  .min(1)
  .max(20)
  .describe("Ordered stops, each a place name or \"lat,lon\". First one is the start.");

/** Log each call to stderr, and return the result to the model as JSON. */
function traced<I, O>(name: string, fn: (input: I) => Promise<O>) {
  return async (input: I): Promise<string> => {
    const started = Date.now();
    process.stderr.write(`\x1b[2m  -> ${name}(${JSON.stringify(input)})\x1b[0m\n`);
    try {
      const result = JSON.stringify(await fn(input));
      process.stderr.write(`\x1b[2m     ok, ${Date.now() - started} ms\x1b[0m\n`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\x1b[2m     failed: ${message}\x1b[0m\n`);
      throw error; // the tool runner reports it to the model as an is_error result
    }
  };
}

/** Build the tool set. Rider preferences are enforced here, not left to the model. */
export function createTools(context: RideContext) {
  const { preferences, store } = context;
  const motorwayRule = preferences.avoidMotorways
    ? "Motorways are always avoided for this rider; if usesMotorway is still true, no motorway-free route exists between those waypoints and they must be changed."
    : "Set avoidMotorways to keep off motorways.";

  /** Serve a tool result from the SQLite cache when a fresh one exists. */
  function cached<I, O>(tool: keyof typeof TTL, fn: (input: I) => Promise<O>, keep: (output: O) => boolean = () => true) {
    return async (input: I): Promise<O> => {
      // Place names resolve relative to the start point, so it is part of the key.
      const key = `${tool}|${fmtCoords(context.home)}|${stableJson(input)}`;
      const hit = store.cacheGet<O>(key);
      if (hit !== undefined) {
        process.stderr.write("\x1b[2m     (from cache)\x1b[0m\n");
        return hit;
      }
      const output = await fn(input);
      if (keep(output)) store.cacheSet(key, tool, output, TTL[tool]);
      return output;
    };
  }

  const cachedTrip = cached<CalculateTripInput, TripComputation>("calculateTrip", computeTrip, (trip) => trip.complete);

  return [
    betaZodTool({
      name: "listSavedRides",
      description:
        "The rider's library of saved rides near a place, with rating (1-5, null if not ridden yet), notes, waypoints and legs. Each leg has coordinates usable directly as calculateTrip waypoints, its main roads, and its own rating when the rider gave one. Call it once at the start: legs rated 4-5 are proven building blocks, rides or legs rated 1-2 are roads to stay away from, and anything already saved is ground the rider has covered.",
      inputSchema: z.object({
        location: location.optional().describe("Centre of the search, default the rider's start point"),
        radiusKm: z.number().min(10).max(500).optional().describe("Default 150"),
      }),
      run: traced("listSavedRides", async (input: { location?: string; radiusKm?: number }) => {
        const centre = input.location ? await resolvePoint(input.location) : context.home;
        const radiusKm = input.radiusKm ?? 150;
        const rides = store
          .listRides()
          .filter((ride) => haversineKm(centre, { lat: ride.centerLat, lon: ride.centerLon }) <= radiusKm)
          .slice(-25)
          .map((ride) => ({
            rideId: ride.id,
            name: ride.name,
            derivedFromRideId: ride.parentId,
            rideDate: ride.rideDate,
            distanceKm: ride.distanceKm,
            ridingMinutes: ride.ridingMinutes,
            rating: ride.rating,
            notes: ride.notes,
            waypoints: ride.waypoints,
            roundTrip: ride.roundTrip,
            legs: ride.legs.map((leg) => ({
              leg: leg.seq,
              from: leg.from,
              to: leg.to,
              fromCoords: leg.fromCoords,
              toCoords: leg.toCoords,
              distanceKm: leg.distanceKm,
              mainRoads: leg.mainRoads,
              rating: leg.rating,
              notes: leg.notes,
            })),
          }));
        return { centre: centre.label, radiusKm, count: rides.length, rides };
      }),
    }),
    betaZodTool({
      name: "getWeather",
      description:
        "Hourly weather forecast for one place on one day (up to 16 days ahead): temperature, rain probability and amount, wind, gusts, sky. Call it for the start point and for several points along a candidate route, covering the hours the rider would actually be there.",
      inputSchema: z.object({
        location,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Day to forecast, YYYY-MM-DD"),
        fromHour: z.number().int().min(0).max(23).optional().describe("First local hour to include, default 8"),
        toHour: z.number().int().min(0).max(23).optional().describe("Last local hour to include, default 20"),
      }),
      run: traced("getWeather", cached("getWeather", getWeather)),
    }),
    betaZodTool({
      name: "searchRoads",
      description:
        "Find winding paved secondary/tertiary roads and mountain passes around a place, from OpenStreetMap. Roads are ranked by curvinessDegPerKm (cumulative heading change per km: under 200 mostly straight, 200-400 flowing bends, over 400 properly twisty mountain road); areaMedianCurviness tells you how twisty the area is overall. Each road comes with `from`/`to` coordinates usable as waypoints in calculateTrip. Search around an area you expect to be good riding country, not around a city centre.",
      inputSchema: z.object({
        location,
        radiusKm: z.number().min(5).max(40).optional().describe("Search radius, default 25, max 40"),
        minLengthKm: z.number().min(1).optional().describe("Ignore roads shorter than this, default 5"),
        limit: z.number().int().min(1).max(25).optional().describe("Max roads returned, default 12"),
      }),
      run: traced("searchRoads", cached("searchRoads", searchRoads)),
    }),
    betaZodTool({
      name: "calculateTrip",
      description: `Route through waypoints in order with a motorcycle profile and return real road distance and riding time (stops excluded), per leg and in total, with each leg's main roads, plus a Google Maps link. Returns a routeId that identifies this exact routed trip. Also returns speedLimits: km and percent of the route posted at 30 km/h or less, at 31-50, above 50, and unposted (no limit tagged in OpenStreetMap, typically open road at the national default), with the longest 30 km/h stretches by road name so you can move waypoints to bypass them. savedRides compares the route with the rider's saved rides: a verdict plus the percent of this route that runs on roads of each similar saved ride. ${motorwayRule} Use it to check every candidate loop; straight-line guesses are not reliable on winding roads.`,
      inputSchema: z.object({
        waypoints,
        roundTrip: z.boolean().optional().describe("Return to the first waypoint at the end, default false"),
        avoidMotorways: z.boolean().optional().describe("Keep off motorways, default true"),
      }),
      run: traced("calculateTrip", async (input: CalculateTripInput) => {
        const trip = await cachedTrip({
          waypoints: input.waypoints,
          roundTrip: input.roundTrip ?? false,
          avoidMotorways: preferences.avoidMotorways || (input.avoidMotorways ?? true),
        });
        const route = registerRoute(context, trip);
        return { routeId: route.id, ...trip.result, savedRides: savedRideOverlap(context, route.cells) };
      }),
    }),
    betaZodTool({
      name: "getTraffic",
      description:
        "Expected traffic delay along a route for a given departure time. May report that no traffic source is configured; in that case say so in the answer instead of estimating.",
      inputSchema: z.object({
        waypoints,
        departAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
          .describe("Local departure date-time, e.g. 2026-10-03T09:00:00"),
        roundTrip: z.boolean().optional().describe("Return to the first waypoint at the end, default false"),
      }),
      run: traced("getTraffic", (input: Parameters<typeof getTraffic>[0]) =>
        getTraffic({ ...input, avoidMotorways: preferences.avoidMotorways }),
      ),
    }),
  ];
}
