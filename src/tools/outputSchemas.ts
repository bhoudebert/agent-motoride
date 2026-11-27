// What each shared tool returns, as zod schemas. They are sent to MCP clients as the
// tools' outputSchema (so code-mode clients get typed functions) and checked against
// every real result by test/outputSchemas.tools.test.ts. Keep them in step with the
// code that builds each result; the .describe() texts are the documentation a model sees.
import { z } from "zod";
import { ScoutReport } from "../schema.ts";

/**
 * A guarded tool's earlier result comes back with these two keys beside it (see `traced`).
 * A tool with a `note` of its own (getDaylight, getSpeedCameras) has it replaced by the repeat notice then.
 */
const repeatKeys = {
  repeatedCall: z.number().optional().describe("Present when this exact call was already made: how many times so far"),
  repeatNote: z
    .string()
    .optional()
    .describe("Present with repeatedCall: the result is the earlier one, do not call again"),
};
const withRepeat = <T extends z.ZodRawShape>(shape: T) => z.object({ ...repeatKeys, ...shape });

const coords = z.string().describe('"lat,lon" decimal degrees, usable as a calculateTrip waypoint');
const nullableString = z.string().nullable();

const daylight = z.object({
  sunrise: z.string().describe("Local HH:MM"),
  sunset: z.string().describe("Local HH:MM"),
  firstLight: nullableString.describe("Local HH:MM, start of civil twilight; null when there is none that day"),
  lastLight: nullableString.describe("Local HH:MM, end of civil twilight; null when there is none that day"),
  daylightHours: z.number(),
});

// ---------- listSavedRides ----------

const savedLeg = z.object({
  leg: z.number().int().describe("Leg number, from 1"),
  from: z.string(),
  to: z.string(),
  fromCoords: coords,
  toCoords: coords,
  distanceKm: z.number(),
  mainRoads: z.array(z.string()),
  rating: z.number().nullable().describe("The rider's rating 0-5 of this leg, null if not rated"),
  notes: nullableString,
});

export const listSavedRidesOutput = withRepeat({
  centre: z.string().describe("Label of the centre of the search"),
  radiusKm: z.number(),
  count: z.number().int().describe("Number of rides listed (the 25 most recent within the radius)"),
  rides: z.array(
    z.object({
      rideId: z.number().int().describe("Roadbook number"),
      name: z.string(),
      derivedFromRideId: z.number().int().nullable().describe("Roadbook this one was derived from, if any"),
      rideDate: nullableString.describe("YYYY-MM-DD of the last planned day, null if none"),
      distanceKm: z.number(),
      ridingMinutes: z.number(),
      rating: z.number().nullable().describe("The rider's rating 1-5, null if not ridden yet"),
      notes: nullableString,
      waypoints: z.array(z.string()),
      roundTrip: z.boolean(),
      daylight: daylight
        .extend({
          sunrise: nullableString,
          sunset: nullableString,
        })
        .nullable()
        .describe("Gathered at save or refresh; null on rides saved before that existed"),
      fixedCameras: z.number().int().nullable().describe("Number of fixed speed cameras on the route; null if unknown"),
      stops: z
        .record(z.string(), z.array(z.string()))
        .nullable()
        .describe('Stops found along the route by kind ("fuel", "cafe"...), each as "name (km N)"; null if unknown'),
      legs: z.array(savedLeg),
    }),
  ),
  roadRatings: z.array(
    z.object({
      road: z.string(),
      rating: z.number().describe("0-1 avoid, 4-5 loved"),
      why: nullableString.describe("The rider's reason"),
      approximate: z.boolean().describe("Placed from the plan and elapsed time, not from a recorded track"),
    }),
  ),
});

// ---------- recallArea ----------

const kmAway = z.number().describe("Distance from the centre asked about, km");
const stretch = z.object({
  rating: z.number(),
  kmAway,
  road: z.string().optional().describe("Name of a stretch rated directly"),
  why: nullableString.optional().describe("The rider's reason, on a stretch rated directly"),
  approximate: z.boolean().optional().describe("On a stretch rated directly: placed from the plan, not a track"),
  rideId: z.number().int().optional().describe("On a rated leg: its roadbook"),
  leg: z.number().int().optional().describe("On a rated leg: its number"),
  from: z.string().optional().describe("On a rated leg: where it starts"),
  to: z.string().optional().describe("On a rated leg: where it ends"),
  fromCoords: nullableString.optional().describe("Start of the stretch as lat,lon; null when not known"),
  toCoords: nullableString.optional().describe("End of the stretch as lat,lon; null when not known"),
  mainRoads: z.array(z.string()).optional(),
  notes: nullableString.optional(),
});

export const recallAreaOutput = z.object({
  centre: z.string().describe("Label of the centre of the region"),
  radiusKm: z.number(),
  note: z.string(),
  savedRides: z.array(
    z.object({
      rideId: z.number().int(),
      name: z.string(),
      distanceKm: z.number(),
      rating: z.number().nullable(),
      notes: nullableString,
      kmAway,
    }),
  ),
  lovedStretches: z.array(stretch).describe("Rated 4-5: route through them when they fit"),
  avoidedStretches: z.array(stretch).describe("Rated 0-1: stay away"),
  scoutedAreas: z.array(
    z.object({
      area: z.string(),
      found: z.boolean().describe("Whether the scout found a loop that met the constraints"),
      distanceKm: z.number().nullable(),
      openRoadPct: z.number().nullable(),
      pct50: z.number().nullable().describe("Share of distance in 31-50 km/h zones"),
      verdict: z.string(),
      scoutedDaysAgo: z.number(),
      kmAway,
    }),
  ),
  knownWindingRoads: z.array(
    z.object({
      road: z.string(),
      curvinessDegPerKm: z.number().nullable(),
      lengthKm: z.number().nullable(),
      from: coords.optional(),
      to: coords.optional(),
      foundDaysAgo: z.number(),
      kmAway,
    }),
  ),
  wordMatches: z
    .array(
      z.object({
        kind: z.enum(["ride", "leg", "road", "scout", "roads"]),
        title: z.string(),
        rating: z.number().nullable(),
        at: z.object({ lat: z.number(), lon: z.number() }).nullable(),
        data: z.unknown().describe("The stored item; its fields depend on kind"),
      }),
    )
    .optional()
    .describe("Only when a query was given"),
});

// ---------- getWeather ----------

const modelReading = z.object({
  rainMm: z.number().nullable(),
  gustKmh: z.number().nullable(),
});

export const getWeatherOutput = withRepeat({
  location: z.string(),
  coords: z.object({ lat: z.number(), lon: z.number() }),
  date: z.string().describe("YYYY-MM-DD"),
  timezone: z.string(),
  daylight: daylight.nullable().describe("Null during polar day or night"),
  summary: z.object({
    dry: z.boolean().describe("Every model dry: max rain probability under 25% and under 0.2 mm in all"),
    maxRainProbPct: z.number(),
    totalRainMm: z.number().describe("Sum over the hours of the highest rain of any model"),
    minTempC: z.number(),
    maxTempC: z.number(),
    maxGustKmh: z.number(),
    modelsDisagree: z.boolean(),
    disagreement: nullableString.describe("Hours where the models disagree on rain or gusts; mention it to the rider"),
    models: z.array(
      z.object({
        model: z.string(),
        totalRainMm: z.number(),
        maxGustKmh: z.number().nullable(),
      }),
    ),
  }),
  hours: z.array(
    z.object({
      hour: z.number().int().describe("Local hour 0-23"),
      tempC: z.number(),
      rainProbPct: z.number().nullable().describe("Highest probability of any model; null when none gives one"),
      rainMm: z.number().describe("Most rain of any model"),
      windKmh: z.number(),
      gustKmh: z.number().describe("Strongest gust of any model"),
      windFromDeg: z
        .number()
        .nullable()
        .describe("Direction the wind blows from, degrees clockwise from north, of the model with the strongest gust"),
      sky: z
        .string()
        .describe('"clear", "partly cloudy", "overcast", "fog", "drizzle", "rain", "snow"... or "unknown"'),
      models: z.record(z.string(), modelReading).describe("Rain and gust of each forecast model, by model name"),
    }),
  ),
});

// ---------- getDaylight ----------

export const getDaylightOutput = withRepeat({
  location: z.string(),
  date: z.string().describe("YYYY-MM-DD"),
  timezone: z.string(),
  sunrise: nullableString.describe("Local HH:MM; null in polar day or night"),
  sunset: nullableString.describe("Local HH:MM; null in polar day or night"),
  firstLight: nullableString.describe("Local HH:MM, start of civil twilight; null when there is none"),
  lastLight: nullableString.describe(
    "Local HH:MM, end of civil twilight; the latest the road is visible without lights",
  ),
  daylightHours: z.number().describe("0 in polar night"),
  note: z.string().describe("Advice on reading the result; replaced by the repeat notice when the call is repeated"),
});

// ---------- searchRoads ----------

export const searchRoadsOutput = withRepeat({
  center: z.string(),
  radiusKm: z.number(),
  roadsConsidered: z.number().int().describe("Roads at least minLengthKm long, before the limit is applied"),
  areaMedianCurviness: z.number().describe("Median curvinessDegPerKm of the area: how twisty it is overall"),
  roads: z.array(
    z.object({
      ref: z.string().describe('Road reference, e.g. "D 518"'),
      names: z.array(z.string()).describe("Up to 3 street or road names"),
      roadClass: z.string().describe('"secondary", "tertiary" or "secondary/tertiary"'),
      lengthKm: z.number(),
      curvinessDegPerKm: z
        .number()
        .describe("Cumulative heading change per km: under 200 mostly straight, 200-400 flowing, over 400 twisty"),
      from: coords.describe("One end of the stretch, lat,lon"),
      to: coords.describe("The other end of the stretch, lat,lon"),
    }),
  ),
  mountainPasses: z.array(
    z.object({
      name: z.string(),
      elevationM: z.number().nullable(),
      coords,
    }),
  ),
});

// ---------- calculateTrip, importRoute ----------

const zoneShare = z.object({ km: z.number(), pct: z.number() });
const namedStretches = z.array(z.object({ road: z.string(), km: z.number() }));

const speedLimits = z.union([
  z.object({
    openRoadPct: z.number().describe("Share of distance outside built-up areas and off motorways: maximise"),
    timeOnRoads70PlusPct: z.number().describe("Share of riding time on roads whose limit is 70 km/h or more"),
    timeAbove70EstimatedPct: z.number().describe("Share of riding time at an estimated 70 km/h or more"),
    distanceLimit70PlusPct: z.number(),
    limit30OrLess: zoneShare.describe("Zones of 30 km/h or less"),
    limit31to50: zoneShare.extend({
      ofWhichUntaggedBuiltUpKm: z.number().describe("Km of it with no limit tagged, counted as 50 in built-up areas"),
    }),
    limitAbove50: zoneShare.describe("Posted limits above 50"),
    untaggedOpenRoad: zoneShare.extend({
      assumedLimitsKm: z
        .record(z.string(), z.number())
        .describe('Km by the legal default assumed for them, keyed like "80 km/h"'),
    }),
    motorwayKm: z.number(),
    fastExpressway: zoneShare.extend({
      longest: namedStretches.describe("Longest stretches by road name"),
    }),
    longStraights: zoneShare.extend({
      longest: z
        .array(
          z.object({
            road: z.string(),
            leg: z.number().int(),
            km: z.number(),
            at: coords.describe("Where the straight starts"),
          }),
        )
        .describe("Up to 4 stretches that keep to one straight line for 2 km or more"),
    }),
    longest30Zones: namedStretches.describe("Longest stretches in 30 zones, by road name"),
    longest50Zones: namedStretches.describe("Longest stretches in 31-50 zones, by road name: bypass them"),
    surface: z.object({
      roughPavedKm: z.number().describe("Cobbles or setts"),
      unpavedKm: z.number(),
      stretches: z.array(
        z.object({
          road: z.string(),
          leg: z.number().int(),
          surface: z.string().describe('"cobbles or setts" or the unpaved surface'),
          km: z.number(),
        }),
      ),
    }),
  }),
  z
    .object({ unavailable: z.string().describe("Why the speed-limit lookup failed; slow-zone share is unverified") })
    .describe("When the speed-limit data could not be fetched"),
]);

const tripLeg = z.object({
  from: z.string(),
  to: z.string(),
  fromCoords: coords,
  toCoords: coords,
  distanceKm: z.number(),
  ridingMinutes: z.number().describe("Estimated, without stops or traffic"),
  ridingTime: z.string().describe('"1h05"'),
  avgSpeedKmh: z.number(),
  routerMinutes: z.number().describe("The router's own, pessimistic, time"),
  usesMotorway: z.boolean(),
  mainRoads: z.array(z.string()).describe('Up to 4, like "D 518 (12.3 km)"'),
});

const tripFields = {
  totalDistanceKm: z.number(),
  totalRidingTime: z.string().describe('"3h05"'),
  totalRidingMinutes: z.number(),
  avgSpeedKmh: z.number(),
  timeBasis: z.string(),
  routerUpperBoundTime: z.string().describe("The router's own, pessimistic, time"),
  motorwaysAvoided: z.boolean().describe("This trip was routed with motorways excluded"),
  usesMotorway: z.boolean(),
  usesTollRoad: z.boolean(),
  speedLimits,
  legs: z.array(tripLeg),
  mapsUrl: z.string().describe("Plain Google Maps link through the waypoints only"),
  navigationLinks: z
    .array(z.string())
    .describe("Google Maps links with pass-through points that keep to the chosen roads; several for a long loop"),
  overviewLink: z.string().optional().describe("Only with several navigationLinks: the whole ride, not for navigating"),
};

const savedRides = z.object({
  verdict: z.string(),
  overlaps: z.array(
    z.object({
      rideId: z.number().int(),
      name: z.string(),
      overlapPct: z.number().describe("Share of this route on roads of that saved ride"),
      rating: z.number().nullable(),
      baseRideOfThisSession: z.boolean(),
    }),
  ),
});

const ratedRoads = z.object({
  avoidPct: z.number().describe("Share of the route on roads the rider rated 0-1"),
  lovedPct: z.number().describe("Share of the route on roads the rider rated 4-5"),
  verdict: z.string(),
});

export const calculateTripOutput = z.object({
  routeId: z.string().describe("Identifies this exact routed trip in the session"),
  motorwaysPermitted: z.boolean().describe("Whether the rider currently permits motorways"),
  ...tripFields,
  savedRides: savedRides.describe("How the route compares with the rider's saved rides"),
  ratedRoads,
});

export const importRouteOutput = z.object({
  routeId: z.string(),
  file: z.object({
    name: nullableString.describe("Name found in the file"),
    lengthKm: z.number(),
    loop: z.boolean().describe("The file's line ends where it starts"),
  }),
  fidelityPct: z.number().describe("Share of the file's line the routed trip follows; under 90, say where it differs"),
  legsOffTheFile: z
    .array(z.object({ leg: z.number().int(), coveragePct: z.number() }))
    .describe("Legs that follow their stretch of the file under 85%"),
  waypoints: z.array(z.string()).describe("Waypoints used, as lat,lon; edit and route again with calculateTrip"),
  roundTrip: z.boolean(),
  motorwaysPermitted: z.boolean(),
  ...tripFields,
  savedRides,
  ratedRoads,
});

// ---------- getTraffic ----------

export const getTrafficOutput = withRepeat({
  available: z.boolean().describe("False when no traffic source is configured or allowed: then only reason is given"),
  reason: z.string().optional().describe("When available is false: why. Do not guess traffic"),
  departAt: z.string().optional().describe("Local departure date-time asked for"),
  distanceKm: z.number().optional(),
  travelMinutes: z.number().optional().describe("Travel time with traffic"),
  freeFlowMinutes: z
    .number()
    .nullable()
    .optional()
    .describe("Travel time without traffic; null if the source gave none"),
  trafficDelayMinutes: z
    .number()
    .optional()
    .describe("Expected congestion for the departure: report it on top of the riding time"),
  incidentDelayMinutes: z.number().optional().describe("The part of the delay due to reported incidents"),
});

// ---------- getSpeedCameras ----------

export const getSpeedCamerasOutput = withRepeat({
  count: z.number().int(),
  cameras: z.array(
    z.object({
      kmAlongRoute: z.number(),
      leg: z.number().int(),
      between: z.string().describe('"from -> to" of the leg'),
      limitKmh: z.union([z.number(), z.string()]).nullable().describe("Posted limit; a string when not a plain number"),
      direction: nullableString,
      type: nullableString.describe("Camera type as mapped, when known"),
      coords,
    }),
  ),
  note: z.string().describe("Coverage caveats; replaced by the repeat notice when the call is repeated"),
});

// ---------- findStops ----------

const foundStop = z.object({
  kmAlongRoute: z.number(),
  leg: z.number().int(),
  name: z.string().describe('"<kind> (unnamed)" when the map has no name'),
  brand: nullableString,
  openingHours: nullableString.describe("OpenStreetMap opening_hours text, when mapped"),
  detourM: z.number().describe("Distance from the route, metres"),
  place: nullableString.describe("Town or village from the address tags"),
  street: nullableString,
  coords,
});
const stopsOfKind = z.object({
  found: z.number().int(),
  listed: z.number().int(),
  stops: z.array(foundStop).describe("Ordered by distance from the start"),
  legsHint: z.array(z.string()).describe('"1: from -> to" per leg'),
});

export const findStopsOutput = withRepeat({
  totalKm: z.number(),
  fuel: stopsOfKind.optional().describe("Only when asked for"),
  cafe: stopsOfKind.optional().describe("Only when asked for"),
  restaurant: stopsOfKind.optional().describe("Only when asked for"),
  bakery: stopsOfKind.optional().describe("Only when asked for"),
});

// ---------- planStops ----------

export const planStopsOutput = z.object({
  profile: z.object({
    tankRangeKm: z.number(),
    reserveKm: z.number(),
    pauseEveryMin: z.number(),
    maxStintMin: z.number(),
    lunch: z.boolean(),
  }),
  date: nullableString.describe("Ride date the opening hours were checked against, null if none given"),
  fuelAtStartKm: z.number(),
  stops: z.array(
    z.object({
      kind: z.enum(["fuel", "pause", "lunch"]),
      name: z.string(),
      kmAlongRoute: z.number(),
      leg: z.number().int(),
      eta: z.string().describe("Clock time of arrival, HH:MM, breaks included"),
      coords,
      openingHours: nullableString,
      detourM: z.number(),
      reason: z.string(),
      where: z.string().describe("Street and village, or the road and nearest village"),
      openAtArrival: z
        .enum(["open", "closed", "unknown"])
        .describe('"unknown" when no date was given, or the hours are not mapped or not readable'),
    }),
  ),
  warnings: z.array(z.string()).describe("No fuel in reach, long stint, closed stops..."),
  navigationLinksWithStops: z
    .array(z.string())
    .describe("Google Maps links that include the stops; several for a long ride"),
  overviewLink: z.string().optional().describe("Only with several links: the whole ride, not for navigating"),
  alternatives: z.object({
    fuel: z.array(z.string()).describe('"name km N"'),
    cafeOrBakery: z.array(z.string()),
    restaurant: z.array(z.string()),
  }),
});

// ---------- checkConditions ----------

const conditionStretch = z.object({
  leg: z.number().int(),
  fromKm: z.number(),
  toKm: z.number(),
  at: z.string().describe("Local clock time the stretch starts, HH:MM"),
  detail: z.string(),
  value: z.number().describe("Worst value in the stretch: crosswind gust km/h, or sun elevation degrees"),
});

export const checkConditionsOutput = withRepeat({
  crosswind: z
    .array(conditionStretch)
    .describe("Gusts of 35 km/h or more across the direction of travel (50+: strong)"),
  glare: z.array(conditionStretch).describe("Sun 0-15 degrees above the horizon within 30 degrees ahead"),
  windChecked: z.boolean().describe("False when the date is beyond the forecast range: glare only"),
  summary: z.array(z.string()).describe("One line per stretch, or that there is none"),
});

// ---------- scoutAreas ----------

export const scoutAreasOutput = z.object({
  reports: z
    .array(ScoutReport.extend({ longStraightsPct: z.number().optional().describe("Read from the routed loop") }))
    .describe("One per scouted area, best first; empty when scouts cannot run"),
  notes: z.array(z.string()),
  briefs: z
    .array(z.object({ area: z.string(), brief: z.string() }))
    .optional()
    .describe("Only when the client runs the scouts itself: what to tell each scout subagent"),
});
