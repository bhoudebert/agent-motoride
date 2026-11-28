// Output schemas of the tools registered by hand in rideServer.ts (the shared tools carry theirs in
// tools/outputSchemas.ts). An MCP outputSchema must be an object at the root; each result is returned
// as structuredContent beside the readable text block, so a typed or code-mode client gets fields.
import { z } from "zod";

const roadbookId = z.number().int().describe('Roadbook number: what the rider calls "ride 7"');
const rating = z.number().int().min(0).max(5).describe("0 never again, 5 loved");
const nullableRating = rating.nullable().describe("0 never again, 5 loved; null when not rated");
const latLon = z.object({ lat: z.number(), lon: z.number() });

export const rideSettingsOutput = z.object({
  home: z
    .object({ label: z.string(), lat: z.number(), lon: z.number() })
    .nullable()
    .describe("Start and end point in force, geocoded; null until one is set"),
  preferences: z.object({
    avoidMotorways: z.boolean(),
    max30Pct: z.number().describe("Target max % of distance in zones of 30 km/h or less"),
    max50Pct: z.number().describe("Target max % of distance in 31-50 km/h zones"),
    maxFastPct: z.number().optional().describe("Max % on fast expressways (100+ km/h, not motorways); 100 is off"),
    maxStraightPct: z.number().optional().describe("Target max % on long straights (2 km or more)"),
  }),
  allowRepeat: z.boolean().describe("Whether rides that repeat saved ones are accepted"),
  bike: z.object({
    tankRangeKm: z.number(),
    reserveKm: z.number().describe("Fuel this many km before the range runs out"),
    pauseEveryMin: z.number(),
    maxStintMin: z.number(),
    lunch: z.boolean(),
  }),
  savedRoadbooks: z.number().int().describe("Number of roadbooks in the library"),
  runId: z.number().int().describe("Trace run id of this session"),
  pendingNotes: z.string().nullable().describe("One line about ride notes waiting for review, or null"),
  situation: z.string().describe("The settings as a readable text (same as the text block)"),
});

export const reportScoutOutput = z.object({
  remembered: z.literal(true),
  area: z.string(),
  found: z.boolean().describe("Whether a loop meeting the rider's hard limits was found"),
  routeId: z.string().nullable(),
  distanceKm: z.number().nullable().describe("Taken from the routed loop; null without a routeId"),
  openRoadPct: z.number().nullable(),
  pct50: z.number().nullable().describe("Share of the loop in 31-50 km/h zones"),
  verdict: z.string().describe("The verdict as kept: trimmed to 300 characters"),
});

export const checkItineraryOutput = z.object({
  passed: z.boolean().describe("True when no limit is missed"),
  acknowledged: z.boolean().describe("True when the itinerary text itself already says a limit is missed"),
  violations: z.array(z.string()),
  notes: z.array(z.string()).describe("Things to say in the answer"),
});

export const saveRideOutput = z.object({
  status: z
    .enum(["saved", "changed", "not_saved"])
    .describe(
      "saved: a new roadbook; changed: the roadbook in hand was changed in place; not_saved: refused as a repeat",
    ),
  roadbookId: z.number().int().nullable().describe("The roadbook number; null when not saved"),
  name: z.string().nullable(),
  version: z.number().int().nullable().describe("Version of the roadbook after a change in place; null otherwise"),
  reason: z.string().nullable().describe("Why it was not saved (with what to tell the rider); null otherwise"),
});

export const exportGpxOutput = z.object({
  gpxPath: z.string().describe("Path of the GPX file written"),
  pushed: z.boolean().describe("Whether the roadbook was sent to the rider's own server"),
  detail: z
    .string()
    .nullable()
    .describe("What came after the path in the text: the roadbook file, or the push answer; null for a route"),
});

export const refreshRideOutput = z.object({
  roadbookId: roadbookId,
  stopsOnly: z.boolean(),
  failedLookups: z.array(z.string()).describe("Lookups that failed and kept their previous result"),
  view: z.string().describe("The refreshed view, or the new stop plan with stopsOnly"),
});

export const rideBriefingOutput = z.object({
  roadbookId: roadbookId,
  name: z.string(),
  rideDate: z.string().nullable().describe("YYYY-MM-DD of the briefed ride"),
  briefing: z.string().describe("The briefing, ending with the go, caution or no-go verdict"),
});

export const planRideOutput = z.object({
  roadbookId,
  date: z.string().describe("YYYY-MM-DD of the ride"),
  departure: z.string().describe("HH:MM"),
  plan: z.string().describe("The briefing and the navigation links, as returned"),
});

const deleteStatus = z.enum(["deleted", "not_deleted", "confirmation_needed"]);

export const deleteRoadbookOutput = z.object({
  status: deleteStatus.describe("confirmation_needed: ask the rider, then call again with confirm true"),
  roadbookId,
  message: z.string(),
});

export const deleteRideOutput = z.object({
  status: deleteStatus,
  roadbookId,
  date: z.string(),
  message: z.string(),
});

export const deleteStretchRatingOutput = z.object({
  status: deleteStatus,
  stretchId: z.number().int(),
  message: z.string(),
});

export const restoreRoadbookOutput = z.object({
  roadbookId,
  restoredVersion: z.number().int(),
  newVersion: z.number().int().describe("The version number the restored design was saved as"),
  followingRides: z.string().nullable().describe("A note about planned rides that follow the roadbook, or null"),
});

export const copyRoadbookOutput = z.object({
  sourceId: roadbookId,
  roadbookId: roadbookId.describe("Number of the copy"),
  name: z.string(),
});

export const cancelRideOutput = z.object({
  roadbookId,
  rideDayId: z.number().int().describe("Id of the ride (the roadbook on that day)"),
  date: z.string(),
  cancelled: z.literal(true),
});

export const keepRideVersionOutput = z.object({
  roadbookId,
  date: z.string(),
  version: z.number().int().describe("The roadbook version the ride keeps"),
});

export const showRideOutput = z.object({
  roadbookId: roadbookId,
  name: z.string(),
  rideDate: z.string().nullable(),
  departure: z.string().nullable(),
  distanceKm: z.number(),
  ridingMinutes: z.number(),
  rating: nullableRating,
  detail: z.string().describe("The full view as the rider sees it: figures, legs, stops, itinerary"),
});

export const showRideMapOutput = z.object({
  roadbookId: roadbookId,
  name: z.string(),
  mimeType: z.literal("image/png"),
  bytes: z.number().int().describe("Size of the PNG returned as the image content block"),
});

export const exportMarkdownOutput = z.object({
  path: z.string().describe("Path of the Markdown file written"),
  markdown: z.string().nullable().describe("The document, only with includeContent"),
});

export const addRideNoteOutput = z.object({
  noteId: z.number().int(),
  roadbookId: roadbookId,
  rideName: z.string(),
  text: z.string(),
  rating: nullableRating,
  minutesBack: z.number().int().describe("Minutes before the note that it covers"),
  createdAt: z.string().describe("ISO time the note was left"),
  window: z.string().describe("Local clock times the note covers, e.g. 10:32-10:42"),
});

export const reviewRideOutput = z.object({
  status: z
    .enum(["review", "applied", "answered", "form_closed"])
    .describe(
      "review: placements to confirm with the rider; applied: decisions stored; answered: the rider rated in a form and it was stored; form_closed: the rider closed the form, nothing stored",
    ),
  roadbookId: roadbookId.nullable().describe("Null when only decisions were applied"),
  track: z
    .object({
      points: z.number(),
      km: z.number(),
      movingMinutes: z.number(),
      movingAvgKmh: z.number(),
      plannedKm: z.number(),
      plannedMinutes: z.number(),
      plannedAvgKmh: z.number(),
    })
    .nullable()
    .describe("Ridden against planned; null without a recorded track"),
  detours: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      road: z.string(),
      km: z.number(),
      window: z.string(),
    }),
  ),
  notes: z.array(
    z.object({
      noteId: z.number().int(),
      text: z.string(),
      rating: nullableRating.describe("The rating the rider gave with the note, if any"),
      placement: z
        .object({
          road: z.string(),
          from: z.string(),
          to: z.string(),
          window: z.string(),
          km: z.number(),
          approximate: z.boolean().describe("Placed from the plan and elapsed time, not from a recorded track"),
          proposedRating: nullableRating.describe("Proposed from the note; null when the rider must say"),
        })
        .nullable(),
      problem: z.string().nullable(),
    }),
  ),
  results: z.array(z.string()).describe("One line per decision stored; empty for a review"),
});

export const rateRideOutput = z.object({
  status: z
    .enum(["rated", "scope_needed", "cancelled"])
    .describe(
      "scope_needed: ask the rider what was bad, then call again with scope; cancelled: the rider closed the question",
    ),
  target: z.enum(["ride_day", "leg", "roadbook"]).describe("What was rated"),
  roadbookId,
  rating: nullableRating.describe("Null when nothing was rated"),
  leg: z.number().int().nullable(),
  date: z.string().nullable().describe("The day of the ride rated, for ride_day"),
  message: z.string(),
});

export const rateStretchOutput = z.object({
  stretchId: z.number().int().describe("Id for deleteStretchRating"),
  rating,
  summary: z.string().describe("Length, roads and map link to check it is the road the rider rode"),
});

export const capabilitiesOutput = z.object({
  guide: z.string().describe("Everything the app does, grouped by moment, as text to show"),
});

export const listRatedRoadsOutput = z.object({
  roadbooks: z.array(z.object({ id: roadbookId, name: z.string(), rating: rating, notes: z.string().nullable() })),
  legs: z.array(
    z.object({
      roadbookId,
      leg: z.number().int(),
      from: z.string(),
      to: z.string(),
      rating: rating,
      notes: z.string().nullable(),
    }),
  ),
  stretches: z.array(
    z.object({
      id: z.number().int().describe("For deleteStretchRating"),
      road: z.string(),
      rating: rating,
      reason: z.string().nullable(),
      approximate: z.boolean(),
      roadbookId: z
        .number()
        .int()
        .nullable()
        .describe("The roadbook the note was left on; null for a stretch rated directly"),
    }),
  ),
  summary: z.string().describe("The same as readable text"),
});

const pageFields = {
  page: z.number().int().describe("Page returned, from 1"),
  pages: z.number().int(),
  total: z.number().int().describe("Items in all pages"),
};

export const listRoadbooksOutput = z.object({
  ...pageFields,
  roadbooks: z.array(
    z.object({
      id: roadbookId,
      name: z.string(),
      parentId: z.number().int().nullable().describe("The roadbook this one is a variant of"),
      distanceKm: z.number(),
      ridingMinutes: z.number(),
      rides: z.number().int().describe("Rides (days) on this roadbook"),
      nextDate: z.string().nullable().describe("Earliest planned ride from today on"),
      rating: nullableRating,
    }),
  ),
});

export const listRidesOutput = z.object({
  ...pageFields,
  rides: z.array(
    z.object({
      id: z.number().int().describe("Id of the ride (the roadbook on that day)"),
      roadbookId,
      name: z.string(),
      rideDate: z.string().nullable(),
      departure: z.string().nullable(),
      status: z.enum(["planned", "ridden", "cancelled"]),
      stale: z.boolean().describe("The roadbook changed since this ride's day data was gathered"),
      passed: z.boolean().describe("Still planned but its date has passed"),
      distanceKm: z.number(),
      ridingMinutes: z.number(),
      rating: nullableRating,
    }),
  ),
});

export const listRecordedRidesOutput = z.object({
  rides: z.array(
    z.object({
      id: z.string().describe("Recorded ride id, for reviewRecordedRide"),
      name: z.string(),
      startedAt: z.string().describe("ISO time, UTC"),
      distanceKm: z.number(),
      points: z.number().int(),
      roadbook: z.object({ id: roadbookId, name: z.string() }).nullable().describe("The roadbook it followed"),
    }),
  ),
});

export const reviewRecordedRideOutput = z.object({
  status: z
    .enum(["no_recorded_ride", "review", "applied"])
    .describe("review: proposals to put to the rider; applied: their decisions were stored"),
  ride: z.object({ id: z.string(), name: z.string(), distanceKm: z.number() }).nullable(),
  roadbook: z.object({ id: roadbookId, name: z.string() }).nullable().describe("Null when no roadbook matches"),
  proposals: z.array(
    z.object({
      n: z.number().int().describe("The number the rider refers to in decisions"),
      road: z.string().nullable(),
      at: latLon,
      guess: z.number().describe("The limit the roadbook guessed, km/h"),
      median: z.number().describe("Speed held, km/h"),
      p85: z.number().describe("85% of the time under this speed, km/h"),
      seconds: z.number(),
      proposed: z.number().describe("Proposed limit, km/h"),
    }),
  ),
  results: z.array(z.string()).describe("One line per decision stored; empty for a review"),
});

export const planningGuideOutput = z.object({
  guide: z.string().describe("The planning guidance, with the rider's request and settings"),
  roadbookId: roadbookId.nullable().describe("The roadbook the guidance edits; null for a new ride"),
});

/** One schema per hand-registered tool, by name. */
export const RIDE_OUTPUT_SCHEMAS = {
  rideSettings: rideSettingsOutput,
  reportScout: reportScoutOutput,
  checkItinerary: checkItineraryOutput,
  saveRoadbook: saveRideOutput,
  exportGpx: exportGpxOutput,
  refreshRoadbook: refreshRideOutput,
  rideBriefing: rideBriefingOutput,
  planRide: planRideOutput,
  deleteRoadbook: deleteRoadbookOutput,
  deleteRide: deleteRideOutput,
  restoreRoadbook: restoreRoadbookOutput,
  copyRoadbook: copyRoadbookOutput,
  cancelRide: cancelRideOutput,
  showRoadbook: showRideOutput,
  keepRoadbookVersion: keepRideVersionOutput,
  showRoadbookMap: showRideMapOutput,
  exportMarkdown: exportMarkdownOutput,
  addRideNote: addRideNoteOutput,
  reviewRide: reviewRideOutput,
  rateRide: rateRideOutput,
  rateStretch: rateStretchOutput,
  capabilities: capabilitiesOutput,
  listRatedRoads: listRatedRoadsOutput,
  deleteStretchRating: deleteStretchRatingOutput,
  listRoadbooks: listRoadbooksOutput,
  listRecordedRides: listRecordedRidesOutput,
  reviewRecordedRide: reviewRecordedRideOutput,
  listRides: listRidesOutput,
  planningGuide: planningGuideOutput,
} as const;
