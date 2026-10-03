import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { scoutAreas } from "../scouts.ts";
import { pinnedMapsLinks } from "../maps.ts";
import { stopCandidatesFor } from "../library.ts";
import { locateStops, planStops } from "../stops.ts";
import { speedCamerasAlong, stopsAlong, type StopKind } from "./along.ts";
import { ratedOverlap, registerRoute, savedRideOverlap, type RideContext } from "../session.ts";
import { fmtCoords, haversineKm, resolvePoint } from "./geo.ts";
import { searchRoads } from "./roads.ts";
import { getTraffic } from "./traffic.ts";
import { computeTrip, type CalculateTripInput, type TripComputation } from "./trip.ts";
import { getDaylight, getWeather } from "./weather.ts";

// Bump when the shape of cached tool results changes, so stale entries are ignored.
const CACHE_VERSION = 5;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Roads rarely change; routes can (closures, map edits); forecasts move by the hour.
const TTL = { searchRoads: 30 * DAY, calculateTrip: 7 * DAY, getWeather: HOUR, getSpeedCameras: 30 * DAY, findStops: 30 * DAY, getDaylight: 365 * DAY };

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
  .describe('Town ("Florac", "Vannes, France"), street or address ("Avenue de Bretagne, Lille"), or "lat,lon" coordinates');
const waypoints = z
  .array(location)
  .min(1)
  .max(20)
  .describe("Ordered stops, each a town, a street or address, or \"lat,lon\". First one is the start.");

/** Log each call to stderr and to the trace, and return the result to the model as JSON. */
function traced<I, O>(context: RideContext, scope: string, name: string, fn: (input: I) => Promise<O>) {
  return async (input: I): Promise<string> => {
    const started = Date.now();
    const tag = scope === "main" ? "" : `[${scope}] `;
    process.stderr.write(`\x1b[2m  -> ${tag}${name}(${JSON.stringify(input)})\x1b[0m\n`);
    try {
      const output = await fn(input);
      const result = JSON.stringify(output);
      process.stderr.write(`\x1b[2m     ${tag}ok, ${Date.now() - started} ms\x1b[0m\n`);
      context.trace({ scope, kind: "tool", name, ms: Date.now() - started, payload: { input, output } });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\x1b[2m     ${tag}failed: ${message}\x1b[0m\n`);
      context.trace({ scope, kind: "tool", name, ms: Date.now() - started, payload: { input, error: message } });
      throw error; // the tool runner reports it to the model as an is_error result
    }
  };
}

/** A tool as both the API runner and the MCP server see it: schema plus implementation. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run: (input: any) => Promise<string>;
}

export interface ToolOptions {
  /** Trace scope: "main" for the planner, "scout:<area>" for a scout. */
  scope?: string;
  /** Give the planner the scoutAreas tool. Scouts never get it. */
  scouts?: boolean;
  /** Restrict to these tool names. */
  only?: string[];
}

/** Tools for the API tool runner. */
export function createTools(context: RideContext, options: ToolOptions = {}) {
  return createToolDefinitions(context, options).map((definition) => betaZodTool(definition));
}

/** Build the tool set. Rider preferences are enforced here, not left to the model. */
export function createToolDefinitions(context: RideContext, options: ToolOptions = {}): ToolDefinition[] {
  const { store } = context;
  const scope = options.scope ?? "main";
  const trace = <I, O>(name: string, fn: (input: I) => Promise<O>) => traced<I, O>(context, scope, name, fn);
  // The rider can switch motorways on or off during a session, so the rule is
  // read from the context at each call and reported back in every result,
  // rather than written into the (fixed) tool descriptions.
  const mayUseMotorways = (requested: boolean | undefined) => !context.preferences.avoidMotorways && requested === false;

  /** Serve a tool result from the SQLite cache when a fresh one exists. */
  function cached<I, O>(tool: keyof typeof TTL, fn: (input: I) => Promise<O>, keep: (output: O) => boolean = () => true) {
    return async (input: I): Promise<O> => {
      // Place names resolve relative to the start point, so it is part of the key.
      const key = `${tool}@${CACHE_VERSION}|${fmtCoords(context.home)}|${stableJson(input)}`;
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

  /** Cache lookups made along a route by the route's geometry, which outlives the session's route ids. */
  async function cachedAlong<O>(label: string, shapes: string[], fn: () => Promise<O>): Promise<O> {
    const tool = label.split("|")[0] as keyof typeof TTL;
    const key = `${label}@${CACHE_VERSION}|${shapes.join("").length}:${shapes.map((s) => s.slice(0, 24) + s.slice(-24)).join("|")}`;
    const hit = store.cacheGet<O>(key);
    if (hit !== undefined) {
      process.stderr.write("\x1b[2m     (from cache)\x1b[0m\n");
      return hit;
    }
    const output = await fn();
    store.cacheSet(key, tool, output, TTL[tool]);
    return output;
  }

  const tools: ToolDefinition[] = [
    {
      name: "listSavedRides",
      description:
        "The rider's library of saved rides near a place, with rating (1-5, null if not ridden yet), notes, waypoints and legs. Each leg has coordinates usable directly as calculateTrip waypoints, its main roads, and its own rating when the rider gave one. Call it once at the start: legs rated 4-5 are proven building blocks, rides or legs rated 1-2 are roads to stay away from, and anything already saved is ground the rider has covered.",
      inputSchema: z.object({
        location: location.optional().describe("Centre of the search, default the rider's start point"),
        radiusKm: z.number().min(10).max(500).optional().describe("Default 150"),
      }),
      run: trace("listSavedRides", async (input: { location?: string; radiusKm?: number }) => {
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
            // Gathered at save or refresh; absent on rides saved before that existed.
            daylight: ride.extras?.daylight ?? null,
            fixedCameras: ride.extras?.cameras.length ?? null,
            stops: ride.extras ? Object.fromEntries(Object.entries(ride.extras.stops).map(([k, v]) => [k, v.map((s) => `${s.name} (km ${s.kmAlongRoute})`)])) : null,
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
    },
    {
      name: "getWeather",
      description:
        "Hourly weather forecast for one place on one day (up to 16 days ahead): temperature, rain probability and amount, wind, gusts, sky. Call it for the start point and for several points along a candidate route, covering the hours the rider would actually be there.",
      inputSchema: z.object({
        location,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Day to forecast, YYYY-MM-DD"),
        fromHour: z.number().int().min(0).max(23).optional().describe("First local hour to include, default 8"),
        toHour: z.number().int().min(0).max(23).optional().describe("Last local hour to include, default 20"),
      }),
      run: trace("getWeather", cached("getWeather", getWeather)),
    },
    {
      name: "searchRoads",
      description:
        "Find winding paved secondary/tertiary roads and mountain passes around a place, from OpenStreetMap. Roads are ranked by curvinessDegPerKm (cumulative heading change per km: under 200 mostly straight, 200-400 flowing bends, over 400 properly twisty mountain road); areaMedianCurviness tells you how twisty the area is overall. Each road comes with `from`/`to` coordinates usable as waypoints in calculateTrip. Search around an area you expect to be good riding country, not around a city centre.",
      inputSchema: z.object({
        location,
        radiusKm: z.number().min(5).max(40).optional().describe("Search radius, default 25, max 40"),
        minLengthKm: z.number().min(1).optional().describe("Ignore roads shorter than this, default 5"),
        limit: z.number().int().min(1).max(25).optional().describe("Max roads returned, default 12"),
      }),
      run: trace("searchRoads", cached("searchRoads", searchRoads)),
    },
    {
      name: "calculateTrip",
      description: `Route through waypoints in order with a motorcycle profile. Returns a routeId identifying this exact routed trip, real road distance, and per leg and in total: estimated riding time and average speed (from each road segment's speed limit and bends, without stops or traffic; the router's own pessimistic time is given as routerUpperBoundTime), main roads, and a Google Maps link. speedLimits gives openRoadPct (share of distance outside built-up areas and off motorways, the figure to maximise), km and percent in zones of 30 km/h or less and of 31-50 km/h (untagged streets in built-up areas are counted as 50 zones), above 50, and untagged open road (assumed at the legal default of its country and region), plus the longest 30 and 50 stretches by road name so you can move waypoints to bypass them. savedRides compares the route with the rider's saved rides: a verdict plus the percent of this route that runs on roads of each similar saved ride. ratedRoads tells how much of it runs on roads the rider rated 0-1 (avoid) or 4-5 (loved). Motorways: the result says whether the rider currently permits them (motorwaysPermitted) and whether this trip was routed with them excluded (motorwaysAvoided). When they are not permitted they are excluded whatever you pass; if usesMotorway is still true, no motorway-free route exists between those waypoints and they must be changed. When they are permitted, pass avoidMotorways false to let the router take them where faster. Use it to check every candidate loop; straight-line guesses are not reliable on winding roads.`,
      inputSchema: z.object({
        waypoints,
        roundTrip: z.boolean().optional().describe("Return to the first waypoint at the end, default false"),
        avoidMotorways: z
          .boolean()
          .optional()
          .describe("Default true. False takes motorways where faster, and only has effect when the rider permits motorways"),
      }),
      run: trace("calculateTrip", async (input: CalculateTripInput) => {
        const trip = await cachedTrip({
          waypoints: input.waypoints,
          roundTrip: input.roundTrip ?? false,
          avoidMotorways: !mayUseMotorways(input.avoidMotorways),
        });
        const route = registerRoute(context, trip);
        return {
          routeId: route.id,
          motorwaysPermitted: !context.preferences.avoidMotorways,
          ...trip.result,
          savedRides: savedRideOverlap(context, route.cells),
          ratedRoads: ratedOverlap(context, route.cells),
        };
      }),
    },
    {
      name: "getTraffic",
      description:
        "Expected traffic along a route for a given departure time: travel time with traffic, free-flow time and the delay between them. Meant for the final loop once it is chosen on road data, not for comparing candidates. Report trafficDelayMinutes on top of the riding-time estimate from calculateTrip. May report that no traffic source is configured; in that case say so in the answer instead of estimating.",
      inputSchema: z.object({
        waypoints,
        departAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
          .describe("Local departure date-time, e.g. 2026-10-03T09:00:00"),
        roundTrip: z.boolean().optional().describe("Return to the first waypoint at the end, default false"),
        avoidMotorways: z
          .boolean()
          .optional()
          .describe("Use the same value as the calculateTrip call for this route. Default true"),
      }),
      run: trace("getTraffic", (input: Parameters<typeof getTraffic>[0]) =>
        getTraffic({ ...input, avoidMotorways: !mayUseMotorways(input.avoidMotorways) }),
      ),
    },
    {
      name: "getDaylight",
      description:
        "Sunrise, sunset, first and last usable light, and daylight hours for a place and a date, any date. Use it to set the departure time and to check the return is before sunset; weather results carry the same figures for the forecast day.",
      inputSchema: z.object({ location, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD") }),
      run: trace("getDaylight", cached("getDaylight", getDaylight)),
    },
    {
      name: "getSpeedCameras",
      description:
        "Fixed speed cameras mapped in OpenStreetMap on or beside a routed trip, with position along the route, leg, posted limit and direction. Call it for the final loop so the itinerary can warn where to watch the speed. Fixed cameras only, no mobile controls, and only those mappers recorded.",
      inputSchema: z.object({ routeId: z.string().describe("routeId from calculateTrip") }),
      run: trace("getSpeedCameras", async (input: { routeId: string }) => {
        const route = context.routes.get(input.routeId);
        if (!route) throw new Error(`Unknown routeId ${input.routeId}; route the loop with calculateTrip first.`);
        return cachedAlong("getSpeedCameras", route.trip.shapes, () => speedCamerasAlong(route.trip.shapes, route.trip.result.legs));
      }),
    },
    {
      name: "findStops",
      description:
        "Fuel stations, cafés, restaurants and bakeries within a short detour of a routed trip, ordered by distance from the start, with opening hours when mapped. Use it on the final loop to place a fuel stop within the tank range and a coffee or lunch stop at a sensible point, and name them in the itinerary.",
      inputSchema: z.object({
        routeId: z.string().describe("routeId from calculateTrip"),
        kinds: z.array(z.enum(["fuel", "cafe", "restaurant", "bakery"])).min(1).optional().describe("Default fuel and cafe"),
        radiusM: z.number().int().min(50).max(2000).optional().describe("Max detour from the route in metres, default 400"),
        limitPerKind: z.number().int().min(1).max(40).optional().describe("Default 15"),
      }),
      run: trace("findStops", async (input: { routeId: string; kinds?: StopKind[]; radiusM?: number; limitPerKind?: number }) => {
        const route = context.routes.get(input.routeId);
        if (!route) throw new Error(`Unknown routeId ${input.routeId}; route the loop with calculateTrip first.`);
        const kinds = input.kinds ?? ["fuel", "cafe"];
        const radiusM = input.radiusM ?? 400;
        const limit = input.limitPerKind ?? 15;
        return cachedAlong(`findStops|${kinds.join("+")}|${radiusM}|${limit}`, route.trip.shapes, () =>
          stopsAlong(route.trip.shapes, route.trip.result.legs, kinds, radiusM, limit),
        );
      }),
    },
    {
      name: "planStops",
      description:
        "Choose the stops of a routed trip from the rider's bike profile: the last fuel station before each fuel deadline (tank range minus reserve, from the fuel at departure), a café or bakery pause after the pause interval, a restaurant where the ride crosses midday, preferring places open at the arrival time when the ride date is given. Returns the stops with arrival times and whether each is open, the return time with breaks, warnings (no fuel in reach, long stint), and navigation links that include the stops so they are announced on the bike. Call it once for the final loop, after calculateTrip, and name the stops in the itinerary. findStops is only for browsing alternatives.",
      inputSchema: z.object({
        routeId: z.string().describe("routeId from calculateTrip"),
        departure: z.string().regex(/^\d{1,2}:\d{2}$/).describe("Planned departure time, HH:MM"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Ride date, to check opening hours at arrival"),
        fuelAtStartKm: z.number().min(10).optional().describe("Range left in the tank at departure, km; default a full tank"),
      }),
      run: trace("planStops", async (input: { routeId: string; departure: string; date?: string; fuelAtStartKm?: number }) => {
        const route = context.routes.get(input.routeId);
        if (!route) throw new Error(`Unknown routeId ${input.routeId}; route the loop with calculateTrip first.`);
        const { trip } = route;
        const profile = store.getProfile();
        const candidates = await stopCandidatesFor(store, trip.shapes, trip.result.legs);
        const plan = await locateStops(planStops(trip.result.legs, candidates, profile, input.departure, input.fuelAtStartKm, input.date ?? null));
        context.stopPlans.set(route.id, plan);
        const stopPoints = plan.stops.map((s) => {
          const [lat = 0, lon = 0] = s.coords.split(",").map(Number);
          return { lat, lon, label: `${s.kind}: ${s.name}`, km: s.kmAlongRoute };
        });
        const waypoints = [trip.result.legs[0]!, ...trip.result.legs].map((leg, i) => {
          const [lat = 0, lon = 0] = (i === 0 ? leg.fromCoords : leg.toCoords).split(",").map(Number);
          return { lat, lon };
        });
        return {
          profile,
          ...plan,
          navigationLinksWithStops: pinnedMapsLinks(waypoints, trip.shapes, stopPoints),
          alternatives: {
            fuel: candidates.fuel.slice(0, 12).map((f) => `${f.name} km ${f.kmAlongRoute}`),
            cafeOrBakery: [...candidates.cafe, ...candidates.bakery].sort((a, b) => a.kmAlongRoute - b.kmAlongRoute).slice(0, 12).map((c) => `${c.name} km ${c.kmAlongRoute}`),
            restaurant: candidates.restaurant.slice(0, 8).map((r) => `${r.name} km ${r.kmAlongRoute}`),
          },
        };
      }),
    },
    {
      name: "scoutAreas",
      description:
        "Send one scout per area, in parallel, to find the best loop from the start point through that area within the constraints. Each scout searches roads, assembles and routes a loop, reads its open-road and slow-zone shares, checks the weather, and reports a candidate with its routeId, which you can present directly or route again (free, cached) to refine. Use it once at the start of a new leisure ride with 2 to 4 areas; not for edits, questions or practical trips. Give each area a name and a central town or village of good riding country, not a city.",
      inputSchema: z.object({
        areas: z
          .array(z.object({ name: z.string().describe("Short name for the area, e.g. Vercors"), location }))
          .min(1)
          .max(4),
        rideDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Ride day, YYYY-MM-DD"),
        departure: z.string().describe("Planned departure time, HH:MM"),
        maxDistanceKm: z.number().nullable().describe("Hard distance cap from the rider's request, or null"),
        maxRidingMinutes: z.number().nullable().describe("Hard riding-time cap in minutes, or null"),
        constraints: z.string().describe("The rider's request and constraints, in one paragraph, as scouts will not see the conversation"),
      }),
      run: trace("scoutAreas", (input: Parameters<typeof scoutAreas>[1]) => scoutAreas(context, input)),
    },
  ];
  return tools.filter((tool) => {
    if (tool.name === "scoutAreas" && !options.scouts) return false;
    return !options.only || options.only.includes(tool.name);
  });
}