// MCP server: exposes the ride tools to any Model Context Protocol client
// (Claude Code, Claude desktop, other agents). The client's own model does the
// planning; this process provides tools, state and the planning prompt.
// Standard output carries the protocol, so all logging goes to stderr.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { describeSituation, SYSTEM_CORE } from "./agent.ts";
import { checkItinerary, parseLimits } from "./checks.ts";
import { pickRideForToday, rideBriefing } from "./briefing.ts";
import { routeCells } from "./geometry.ts";
import {
  addRideNote,
  applyReview,
  clockAt,
  formatReview,
  pendingNotesSummary,
  readTrack,
  reviewRide,
  rideToReview,
} from "./feedback.ts";
import { deleteForm, duplicateForm, type ElicitForm, reviewDecisions, reviewForm } from "./elicit.ts";
import { deleteRideQuestion, deleteRoadbookQuestion, rideOnDay, roadbookOf } from "./housekeeping.ts";
import { exportSavedRide, writeGpx } from "./gpx.ts";
import { rideMapPng } from "./rideMap.ts";
import { parseRideDay, planRideFrom } from "./planRide.ts";
import {
  DuplicateRideError,
  enrichRide,
  formatRideDetail,
  formatRatedRoads,
  formatRideDayPage,
  formatRideList,
  formatRoadbookPage,
  replanStops,
  saveCurrentRide,
  tripFigures,
} from "./library.ts";
import { formatRideMarkdown, writeRideMarkdown } from "./markdown.ts";
import { SCOUT_MODEL } from "./model.ts";
import { SCOUT_SYSTEM, type ScoutInput, scoutBrief, scoutStart, scoutsUnavailable } from "./scouts.ts";
import { preferencesFromEnv } from "./preferences.ts";
import { describeProfile } from "./profile.ts";
import type { RideContext } from "./session.ts";
import { formatStopPlan } from "./stops.ts";
import { Store } from "./store.ts";
import { setGeoAnchor, usePersistentGeoCache } from "./tools/geo.ts";
import { createToolDefinitions } from "./tools/index.ts";
import { computeTrip } from "./tools/trip.ts";
import { emptyUsage, estimateCostUsd } from "./usage.ts";

const store = new Store();
// Lookups past their time are never read again; the terminal app drops them at start too.
store.cachePurgeExpired();
// Place names for coordinates never change: keep them across sessions.
usePersistentGeoCache({
  get: (key) => store.cacheGet<string>(key),
  set: (key, value) => store.cacheSet(key, "reverseGeocode", value, 365 * 24 * 3_600_000),
});
const usage = emptyUsage("mcp-client", "n/a");
const runId = store.startRun({
  home: process.env.RIDE_HOME ?? "",
  request: "mcp session",
  usage,
  costUsd: null,
  result: null,
  rideId: null,
  error: null,
});

const context: RideContext = {
  store,
  preferences: preferencesFromEnv(),
  // Placeholder until a start point is set; tools refuse to run before that.
  home: { lat: 0, lon: 0, label: "" },
  allowRepeat: false,
  lineage: new Set(),
  routes: new Map(),
  runId,
  usage,
  trace: (event) => store.addTrace(runId, event),
  stopPlans: new Map(),
};
let homeInput = process.env.RIDE_HOME ?? "";
let lastSavedId: number | null = null;
const requests: string[] = [];
let lastRouteId: string | null = null;

/**
 * Keep the run row current. The client's model is invisible here, so the
 * token figures are the scouts' alone, priced at the scout model; the ride
 * figures come from the saved ride, else from the last routed trip.
 */
function syncRun(): void {
  const route = lastRouteId ? context.routes.get(lastRouteId) : undefined;
  const trip = route?.trip.result;
  const limits = trip?.speedLimits as
    | {
        openRoadPct?: number;
        limit31to50?: { pct: number };
        limit30OrLess?: { pct: number };
        motorwayKm?: number;
        timeOnRoads70PlusPct?: number;
      }
    | undefined;
  store.updateRun(runId, {
    home: homeInput,
    request: requests.length ? requests.join(" / ") : "mcp session (no plan-ride prompt used)",
    usage,
    costUsd: usage.modelCalls ? estimateCostUsd({ ...usage, model: SCOUT_MODEL }) : null,
    result: trip
      ? {
          distanceKm: trip.totalDistanceKm,
          ridingMinutes: trip.totalRidingMinutes,
          openRoadPct: limits?.openRoadPct ?? null,
          pct50: limits?.limit31to50?.pct ?? null,
          pct30: limits?.limit30OrLess?.pct ?? null,
          motorwayKm: limits?.motorwayKm ?? null,
        }
      : null,
    rideId: lastSavedId,
    error: null,
  });
}

async function setHome(location: string): Promise<string> {
  const point = await setGeoAnchor(location);
  context.home = point;
  homeInput = location;
  syncRun();
  return point.label;
}

const settingsText = () => {
  const pending = pendingNotesSummary(store);
  return `${describeSituation(homeInput, context.home.label ? context.home : undefined, context.preferences, new Date(), true)}\nBike: ${describeProfile(store.getProfile())}.\nSaved rides: ${store.listRides().length}. Trace run id: ${runId}.${pending ? `\n${pending}: offer to review them (reviewRide).` : ""}`;
};

// API scouts need a key of their own. Without them, a client that runs
// subagents in parallel (Claude Code) scouts with those, on the rider's plan,
// through this same server so their routeIds are valid here (ADR 0021).
const scoutsOff = scoutsUnavailable();
const CLIENT_SCOUTS = `API scouts are off here (${scoutsOff}), so scoutAreas cannot run. Scout with your own subagents instead when you can run them in parallel (in Claude Code, the Agent tool): pick the 2-4 areas, start one subagent per area in the same turn, and give each the scout brief below with its area, the start point (name and coordinates), the date, the departure and the rider's limits and targets written in. Subagents reach this same server, so the routeIds they report are valid here: compare their reports, take the best candidate and finish it as usual. Without subagents, explore the areas yourself with recallArea, searchRoads, calculateTrip and getWeather.

Scout brief:
${SCOUT_SYSTEM}
Use only the agentMotoride tools (recallArea, searchRoads, calculateTrip, getWeather), never shell commands, scripts or web search. End with a short report: area, found (yes or no), routeId, distance, riding time, open-road and 50-zone shares, weather, verdict in one sentence.`;

/** scoutAreas without API scouts: the way to scout with subagents, and each area's brief ready to hand over. */
async function clientScouting(input: ScoutInput): Promise<string> {
  const start = await scoutStart(context, input);
  return JSON.stringify({
    reports: [],
    notes: [CLIENT_SCOUTS],
    briefs: input.areas.map((area) => ({ area: area.name, brief: scoutBrief(context, input, area, start) })),
  });
}

// Server instructions reach the client's system prompt at connection time, so
// the method applies even when the rider types in plain words instead of using
// the plan-ride command. Kept to the essentials; the command carries the rest.
const INSTRUCTIONS = `agentMotoride plans one-day motorcycle rides and keeps the rider's library of saved rides. Anything the rider says about rides, trips, loops, routes, the library, stops, cameras, weather for a ride, or a ride-day briefing is a request for this server's tools: showRide, showRideMap, listRoadbooks, listRides, rideBriefing, refreshRide, rateRide, exportGpx, exportMarkdown, planningGuide and the planning tools. Never run shell commands, scripts or web searches for these, and never look for a "ride" program: "ride show 7" or "/ride plan ..." typed by the rider means "use the ride tools" (here: showRide for ride 7). A roadbook is a saved loop or trip, with a number ("roadbook 7"; riders may also say "ride 7" for it); a ride is a roadbook on one day, named by its date ("Saturday's ride"): listRoadbooks lists the first, listRides the second, 20 per page. "Plan a ride from roadbook 7 on Saturday at 9", or "plan a ride on Saturday" once a roadbook is the one being discussed, is planRide: it adds a ride to that roadbook, never a copy; replan or edit the route only when the rider asks for a change. "Not riding Saturday" is cancelRide; deleteRoadbook and deleteRide only when the rider asks to delete, and they ask the rider first. Plain words are enough, slash commands are only shortcuts: before planning any new ride asked in plain words, in any client, call planningGuide with the rider's request and follow it, with ride set when it changes a saved ride (the plan-ride and edit-ride commands already carry that guidance).
For a new leisure ride: call listSavedRides and recallArea around the start (what earlier sessions learnt: scouted areas and their verdicts, known winding roads), then ${scoutsOff ? "scout 2-4 areas with parallel subagents as planningGuide explains (API scouts are off here, scoutAreas cannot run)" : "scoutAreas with 2-4 areas"}, skipping areas recently found poor${scoutsOff ? "" : " (or searchRoads and calculateTrip yourself if scouts are unavailable)"}, pick the best candidate, then finish it: getDaylight, getWeather along the loop for the riding hours, getSpeedCameras, checkConditions (crosswind, low sun) with the date and departure, planStops with the date and departure, getTraffic for the departure. Before presenting it, call checkItinerary with its routeId, the rider's request and your text, and fix what it reports once (or say plainly which limit cannot be met). Present the itinerary in plain text (never JSON) with legs named by towns, the figures from the tools, the stops with times, the navigation links from planStops (and its overviewLink as "Whole ride (overview, not for navigation)" when there are several parts), and end with one line "Route: <routeId>". Save only when the rider asks, with saveRide. During a ride, a remark about the road ("last 10 min awesome", "cobbles, never again") is a note: call addRideNote at once with the rider's words, and a rating 0-5 only when they gave one. After the ride, reviewRide places the notes on the recorded track (gpxPath) or on the plan, shows detours and pace, and proposes ratings; apply them with reviewRide and decisions only once the rider confirms. If the rider has a route file (GPX or KML, from another app, a club or a friend), call importRoute with its path: it returns a routeId to present, finish and save like a planned ride. If the rider shares an image (photo of a paper map, route screenshot, list of places), read the places on it in order and route them with calculateTrip by name, then finish the ride as usual. For an edit or a question about a saved ride, work from its data (showRide) without replanning. For a practical trip (commute), route point to point, motorways if permitted, with traffic.`;

const server = new McpServer({ name: "agentMotoride", version: "0.1.0" }, { instructions: INSTRUCTIONS });
const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
});

/** Whether the client can show a form to the rider (MCP elicitation). */
const canElicit = () => Boolean(server.server.getClientCapabilities()?.elicitation);

/** Ask the rider through the client; a person needs longer than a request's default timeout. */
async function ask(form: ElicitForm): Promise<Record<string, unknown> | null> {
  const result = await server.server.elicitInput(
    { message: form.message, requestedSchema: form.requestedSchema } as Parameters<typeof server.server.elicitInput>[0],
    { timeout: 10 * 60_000 },
  );
  context.trace({ scope: "main", kind: "user", name: "elicitation", payload: { action: result.action } });
  return result.action === "accept" ? (result.content ?? {}) : null;
}

/**
 * The four MCP hints of every tool this file registers, set on purpose: clients
 * use them to decide what may run without asking. Shared tools carry theirs in
 * src/tools/index.ts. A tool missing here stops the server at start.
 */
const HINTS: Record<string, ToolAnnotations> = {
  // changes session settings and the bike profile; geocodes the start point
  rideSettings: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  checkItinerary: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  // adds a ride to the library, then gathers its extras online
  saveRide: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  // writes a file, overwriting one at the given path; may route a saved ride again
  exportGpx: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  // recomputes a ride's derived figures; ratings and notes are kept
  refreshRide: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  rideBriefing: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  showRideMap: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  showRide: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  // writes a file, overwriting one at the given path
  exportMarkdown: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  // each call stores one more note
  // Sets a ride's or a leg's rating, replacing the previous one; same call, same state.
  rateRide: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  addRideNote: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  // stores placements and road ratings; map matching online
  reviewRide: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  listRides: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  listRoadbooks: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  // Adds or updates a ride; the same call again changes nothing more. Reads forecasts and map data.
  planRide: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  cancelRide: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  // Deletes, once the rider confirmed; the same call again finds nothing more to delete.
  deleteRoadbook: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  deleteRide: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  planningGuide: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
const hintsOf = (name: string): ToolAnnotations => {
  const hints = HINTS[name];
  if (!hints) throw new Error(`Tool ${name} declares no MCP hints: add it to HINTS in src/mcp.ts.`);
  return hints;
};

// The ride tools, shared with the API planner. Each call is traced and counted.
for (const tool of createToolDefinitions(context, { scouts: true })) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.hints,
    },
    async (args: unknown) => {
      if (!context.home.label) throw new Error("No start point yet: call rideSettings with the rider's home first.");
      usage.toolCalls++;
      const result =
        tool.name === "scoutAreas" && scoutsOff ? await clientScouting(args as ScoutInput) : await tool.run(args);
      if (tool.name === "calculateTrip") lastRouteId = (JSON.parse(result) as { routeId: string }).routeId;
      syncRun();
      return text(result);
    },
  );
}

server.registerTool(
  "rideSettings",
  {
    description:
      "Show or change the rider's settings for this session: start and end point, whether motorways are permitted, and the slow-zone targets. Call it first with the home when the rider has not set one. Returns the settings in force.",
    annotations: hintsOf("rideSettings"),
    inputSchema: z.object({
      home: z.string().optional().describe('Start and end point: town, address or "lat,lon"'),
      allowMotorways: z.boolean().optional(),
      max30Pct: z.number().min(0).max(100).optional(),
      max50Pct: z.number().min(0).max(100).optional(),
      allowRepeat: z.boolean().optional().describe("Accept rides that repeat saved ones"),
      tankRangeKm: z.number().positive().optional().describe("Bike profile: realistic range on a full tank"),
      reserveKm: z.number().positive().optional().describe("Bike profile: fuel this many km before the range runs out"),
      pauseEveryMin: z.number().positive().optional().describe("Bike profile: pause after this much riding"),
      maxStintMin: z.number().positive().optional(),
      lunch: z.boolean().optional().describe("Bike profile: plan a lunch stop when the ride spans midday"),
    }),
  },
  async (args) => {
    const { tankRangeKm, reserveKm, pauseEveryMin, maxStintMin, lunch } = args;
    if ([tankRangeKm, reserveKm, pauseEveryMin, maxStintMin, lunch].some((v) => v !== undefined)) {
      store.setProfile({ tankRangeKm, reserveKm, pauseEveryMin, maxStintMin, lunch });
    }
    if (args.home) await setHome(args.home);
    if (args.allowMotorways !== undefined) context.preferences.avoidMotorways = !args.allowMotorways;
    if (args.max30Pct !== undefined) context.preferences.max30Pct = args.max30Pct;
    if (args.max50Pct !== undefined) context.preferences.max50Pct = args.max50Pct;
    if (args.allowRepeat !== undefined) context.allowRepeat = args.allowRepeat;
    return text(settingsText());
  },
);

server.registerTool(
  "checkItinerary",
  {
    description:
      "Check an itinerary in code before presenting it: routed distance and riding time against the caps in the rider's words, motorways when forbidden, repeats of saved rides, roads rated 0-1, and the distance stated in your text against the routed one. Returns PASS, or what failed. Fix the itinerary once and check again, or say plainly in the answer which limit cannot be met.",
    annotations: hintsOf("checkItinerary"),
    inputSchema: z.object({
      routeId: z.string().describe("routeId of the itinerary, from calculateTrip"),
      request: z.string().describe("The rider's request, in their words"),
      itinerary: z.string().describe("The itinerary text you are about to present"),
    }),
  },
  async (args) => {
    const route = context.routes.get(args.routeId);
    if (!route) throw new Error(`Unknown routeId ${args.routeId}; it must come from calculateTrip in this session.`);
    const { violations, acknowledged, notes } = checkItinerary(
      context,
      route,
      args.itinerary,
      parseLimits(args.request),
    );
    context.trace({ scope: "main", kind: "check", name: violations.length ? "failed" : "passed", payload: violations });
    const say = notes.length ? `\nSay it in the answer:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
    if (!violations.length) return text(`PASS${say}`);
    return text(
      `${acknowledged ? "Failed, but your text already says a limit is missed; present it if that is the closest option." : "FAILED:"}\n${violations.map((v) => `- ${v}`).join("\n")}${say}`,
    );
  },
);

server.registerTool(
  "saveRide",
  {
    description:
      "Save an itinerary to the rider's library. Only when the rider asks to save. routeId must be one returned by calculateTrip in this session; the saved distances and geometry come from that routed trip. A ride that duplicates a saved one (70% or more of the same roads) is refused; pass force only when the rider explicitly wants a copy. Returns the saved ride id.",
    annotations: hintsOf("saveRide"),
    inputSchema: z.object({
      routeId: z.string(),
      name: z.string().describe("A few words a rider would recognise the ride by"),
      rideDate: z.string().nullable().describe("YYYY-MM-DD or null"),
      departure: z.string().nullable().describe("HH:MM or null"),
      itinerary: z.string().describe("The itinerary text as presented to the rider"),
      request: z.string().describe("What the rider asked for, in one line"),
      force: z
        .boolean()
        .optional()
        .describe("Save even if it duplicates a saved ride; only on the rider's explicit wish"),
    }),
  },
  async (args) => {
    const route = context.routes.get(args.routeId);
    if (!route) throw new Error(`Unknown routeId ${args.routeId}; it must come from calculateTrip in this session.`);
    const save = (force: boolean | undefined) =>
      saveCurrentRide(
        context,
        { route, rideDate: args.rideDate, departure: args.departure, title: args.name, itinerary: args.itinerary },
        { name: args.name, request: args.request, parentId: lastSavedId, home: homeInput, usage, force },
      );
    let id: number;
    try {
      id = save(args.force);
    } catch (error) {
      if (!(error instanceof DuplicateRideError)) throw error;
      // The rider decides, in the client's own dialog when it has one.
      if (!canElicit()) {
        return text(
          `Not saved: ${error.message} Tell the rider, and only call saveRide again with force if they want the copy.`,
        );
      }
      const answer = await ask(duplicateForm(error.message));
      if (answer?.save !== true) return text(`Not saved: ${error.message} The rider chose not to keep a copy.`);
      id = save(true);
    }
    lastSavedId = id;
    lastRouteId = args.routeId;
    syncRun();
    void enrichRide(store, store.findRide(String(id))!).catch(() => undefined);
    return text(`Saved as roadbook #${id} "${args.name}". Export with exportGpx, or: npm run rides -- show ${id}`);
  },
);

server.registerTool(
  "exportGpx",
  {
    description:
      "Write a ride as a GPX file for a GPS app: either a routeId from this session or the id of a saved ride. Returns the file path.",
    annotations: hintsOf("exportGpx"),
    inputSchema: z.object({
      routeId: z.string().optional(),
      rideId: z.number().int().optional(),
      name: z.string().optional().describe("Name inside the file, for a routeId"),
      file: z.string().optional().describe("Destination path; default exports/ in the project"),
    }),
  },
  async (args) => {
    if (args.rideId !== undefined) {
      const ride = store.findRide(String(args.rideId));
      if (!ride) throw new Error(`No roadbook #${args.rideId}`);
      const { path } = await exportSavedRide(store, ride, args.file);
      return text(`GPX written: ${path}`);
    }
    const route = args.routeId ? context.routes.get(args.routeId) : undefined;
    if (!route) throw new Error("Give a routeId from calculateTrip in this session, or a saved rideId.");
    const { trip } = route;
    const path = writeGpx(
      {
        name: args.name ?? `Ride ${route.id}`,
        description: `${trip.result.totalDistanceKm} km, about ${trip.result.totalRidingTime} riding. Planned with agentMotoride.`,
        legs: trip.result.legs,
        shapes: trip.shapes,
      },
      route.id,
      args.file,
    );
    return text(`GPX written: ${path}`);
  },
);

server.registerTool(
  "refreshRide",
  {
    description:
      "Recompute a saved ride without changing it: route the same waypoints again with the ride's own motorway setting, update distance, times, road mix and leg names, then re-gather daylight, weather, fixed cameras and stops, and rebuild the stop plan from the current bike profile. Deterministic, no planning involved; takes a minute or two. Use it when the rider says refresh, update or recompute a ride; with stopsOnly when only the stops or the bike profile changed. Returns the refreshed view, or the new stop plan.",
    annotations: hintsOf("refreshRide"),
    inputSchema: z.object({
      ride: z.string().describe("Roadbook number or name"),
      stopsOnly: z
        .boolean()
        .optional()
        .describe("Only rebuild the stop plan from the current bike profile; instant when the stops are cached"),
    }),
  },
  async (args) => {
    const target = store.findRide(args.ride);
    if (!target) throw new Error(`No saved ride matches "${args.ride}". Call listRoadbooks.`);
    if (args.stopsOnly) {
      const extras = await replanStops(store, target);
      if (!extras?.stopPlan)
        throw new Error(`Roadbook #${target.id} has no stored route line; run a full refresh first.`);
      return text(formatStopPlan(extras.stopPlan, target.departure ?? "09:00", target.ridingMinutes).join("\n"));
    }
    await setGeoAnchor(target.home);
    const trip = await computeTrip({
      waypoints: target.waypoints,
      roundTrip: target.roundTrip,
      avoidMotorways: target.preferences.avoidMotorways,
    });
    if (trip.result.legs.length !== target.legs.length)
      throw new Error(
        `Roadbook #${target.id} now routes into ${trip.result.legs.length} legs instead of ${target.legs.length}; not updated.`,
      );
    store.refreshRide(target.id, tripFigures(trip, routeCells(trip.shapes)));
    const extras = await enrichRide(store, store.findRide(String(target.id))!);
    const failed = Object.entries(extras?.errors ?? {}).map(([name, reason]) => `${name}: ${reason.split(".")[0]}`);
    return text(
      `${failed.length ? `Some lookups failed and kept their previous result: ${failed.join("; ")}\n\n` : ""}${formatRideDetail(store.findRide(String(target.id))!)}`,
    );
  },
);

server.registerTool(
  "rideBriefing",
  {
    description:
      "Ride-day briefing for a saved ride: forecast along the route now, daylight and return time, traffic at departure, the stops re-planned and checked against opening hours at arrival, fixed cameras, and a go, caution or no-go verdict with reasons. Deterministic; show it as returned. Without a ride, takes the next dated ride.",
    annotations: hintsOf("rideBriefing"),
    inputSchema: z.object({
      ride: z.string().optional().describe("Roadbook number or name; default the next dated ride"),
    }),
  },
  async (args) => {
    const today = new Date().toISOString().slice(0, 10);
    const target = args.ride ? store.findRide(args.ride) : pickRideForToday(store, today);
    if (!target) throw new Error(args.ride ? `No saved ride matches "${args.ride}".` : "No saved ride to brief.");
    return text(await rideBriefing(store, target, today));
  },
);

server.registerTool(
  "planRide",
  {
    description:
      'Plan a ride from a saved roadbook on a date, without copying it: "plan a ride from roadbook 7 on Saturday at 9", or "plan a ride on Saturday" right after roadbook 7 was shown or discussed. Adds a ride to the roadbook (or updates the one already on that date), gathers the day: forecast along the loop, daylight, crosswind and low sun, the stop plan with opening hours at arrival, traffic at departure; returns the briefing with a go, caution or no-go verdict and the navigation links. Deterministic; show it as returned. Not for changing the route: a change ("50 km longer", "skip Tournai") goes through planningGuide with the roadbook.',
    annotations: hintsOf("planRide"),
    inputSchema: z.object({
      roadbook: z.string().describe("Roadbook number or name"),
      date: z.string().describe("Day of the ride: YYYY-MM-DD, or in words: today, tomorrow, saturday, 17/10"),
      departure: z.string().optional().describe("Departure time, e.g. 09:00; default the roadbook's last departure"),
    }),
  },
  async (args) => {
    const date = parseRideDay(args.date);
    if (!date) throw new Error(`"${args.date}" is not a day: give YYYY-MM-DD, or today, tomorrow, saturday, 17/10.`);
    return text(await planRideFrom(store, args.roadbook, date, args.departure ?? null));
  },
);

/**
 * Delete only once the rider said yes: in the client's dialog when it has one,
 * else in the chat, the model calling again with confirm.
 */
async function confirmedDelete(question: string, confirm: boolean | undefined, tool: string, act: () => string) {
  if (canElicit()) {
    const answer = await ask(deleteForm(question));
    return text(answer?.delete === true ? act() : "Not deleted: the rider said no.");
  }
  if (confirm !== true) {
    return text(
      `${question}\nNothing deleted yet. Ask the rider this question; call ${tool} again with confirm true only if they say yes.`,
    );
  }
  return text(act());
}

const confirmInput = z
  .boolean()
  .optional()
  .describe("Only after the rider said yes to the question a first call returned, in clients without dialogs");

server.registerTool(
  "deleteRoadbook",
  {
    description:
      "Delete a saved roadbook with its rides and notes, after the rider confirms (a dialog, or a question in the chat). Road ratings stay: they are about the roads. Only when the rider asks to delete it.",
    annotations: hintsOf("deleteRoadbook"),
    inputSchema: z.object({ roadbook: z.string().describe("Roadbook number or name"), confirm: confirmInput }),
  },
  async (args) => {
    const saved = roadbookOf(store, args.roadbook);
    return confirmedDelete(deleteRoadbookQuestion(store, saved), args.confirm, "deleteRoadbook", () => {
      store.deleteRide(saved.id);
      // This session's run no longer points to it.
      if (lastSavedId === saved.id) {
        lastSavedId = null;
        syncRun();
      }
      return `Deleted roadbook #${saved.id} "${saved.name}".`;
    });
  },
);

server.registerTool(
  "deleteRide",
  {
    description:
      "Delete one ride (a roadbook on a day), after the rider confirms. The roadbook and the ride's notes stay. To keep the ride but mark it called off, use cancelRide instead.",
    annotations: hintsOf("deleteRide"),
    inputSchema: z.object({
      roadbook: z.string().describe("Roadbook number or name"),
      date: z.string().describe("Day of the ride: YYYY-MM-DD, 10/10, today, or a weekday"),
      confirm: confirmInput,
    }),
  },
  async (args) => {
    const found = rideOnDay(store, args.roadbook, args.date);
    return confirmedDelete(deleteRideQuestion(found), args.confirm, "deleteRide", () => {
      store.deleteRideDay(found.ride.id);
      return `Deleted the ride of ${found.date} from roadbook #${found.saved.id}.`;
    });
  },
);

server.registerTool(
  "cancelRide",
  {
    description:
      'Cancel a planned ride (a roadbook on a day): it stays in the list, shown as cancelled. For "I\'m not riding Saturday".',
    annotations: hintsOf("cancelRide"),
    inputSchema: z.object({
      roadbook: z.string().describe("Roadbook number or name"),
      date: z.string().describe("Day of the ride: YYYY-MM-DD, 10/10, today, or a weekday"),
    }),
  },
  async (args) => {
    const found = rideOnDay(store, args.roadbook, args.date);
    store.cancelRide(found.ride.id);
    return text(
      `Cancelled the ride of ${found.date} from roadbook #${found.saved.id} "${found.saved.name}"; it stays in the list.`,
    );
  },
);

server.registerTool(
  "showRide",
  {
    description:
      "Full view of one saved ride, as the rider sees it in the app: figures, road mix, time at 70+, daylight, fixed cameras, fuel and café stops, legs with names, main roads, times and ratings, map link and the itinerary text. Show it to the rider as is; do not rebuild it from other tools.",
    annotations: hintsOf("showRide"),
    inputSchema: z.object({ ride: z.string().describe("Roadbook number or name") }),
  },
  async (args) => {
    const ride = store.findRide(args.ride);
    if (!ride) throw new Error(`No saved ride matches "${args.ride}". Call listRoadbooks.`);
    return text(formatRideDetail(ride));
  },
);

server.registerTool(
  "showRideMap",
  {
    description:
      "A picture of a saved ride, to show the rider: the route leg by leg, towns in riding order, planned stops with their arrival times, fixed speed cameras with their limits, km marks, scale and the ride's figures. Drawn from the ride's own data, no map background. Returns the image; show it as is. exportMarkdown and rides map also write it to a file.",
    annotations: hintsOf("showRideMap"),
    inputSchema: z.object({ ride: z.string().describe("Roadbook number or name") }),
  },
  async (args) => {
    const ride = store.findRide(args.ride);
    if (!ride) throw new Error(`No saved ride matches "${args.ride}". Call listRoadbooks.`);
    return {
      content: [
        { type: "image" as const, data: rideMapPng(ride).toString("base64"), mimeType: "image/png" },
        { type: "text" as const, text: `Map of roadbook #${ride.id} "${ride.name}".` },
      ],
    };
  },
);

server.registerTool(
  "exportMarkdown",
  {
    description:
      "Write a saved ride as a Markdown document in the app's standard layout (figures, road mix, legs table, daylight, cameras, stops, itinerary), for versioning elsewhere. Returns the file path, and the document itself when asked.",
    annotations: hintsOf("exportMarkdown"),
    inputSchema: z.object({
      ride: z.string().describe("Roadbook number or name"),
      file: z.string().optional().describe("Destination path; default exports/ in the project"),
      includeContent: z.boolean().optional().describe("Also return the Markdown text, default false"),
    }),
  },
  async (args) => {
    const ride = store.findRide(args.ride);
    if (!ride) throw new Error(`No saved ride matches "${args.ride}". Call listRoadbooks.`);
    const path = writeRideMarkdown(ride, args.file);
    return text(
      args.includeContent ? `Markdown written: ${path}\n\n${formatRideMarkdown(ride)}` : `Markdown written: ${path}`,
    );
  },
);

server.registerTool(
  "addRideNote",
  {
    description:
      'During a ride: keep a note about the road just ridden, timed now, e.g. "last 10 min awesome" or "cobbles, never again". The note covers the minutes before it (default 10) and is placed on the road after the ride by reviewRide. Call it as soon as the rider says something about the road, with their words; no planning, no questions. Without a ride, it goes to the ride dated today, else the last saved one.',
    annotations: hintsOf("addRideNote"),
    inputSchema: z.object({
      text: z.string().min(1).describe("The rider's words"),
      rating: z.number().int().min(0).max(5).optional().describe("Only if the rider gave one: 0 never again, 5 loved"),
      minutesBack: z.number().int().min(1).max(120).optional().describe("Minutes the note covers, default 10"),
      ride: z.string().optional().describe("Roadbook number or name; default today's ride"),
    }),
  },
  async (args) => {
    const { note, ride } = addRideNote(store, args);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const end = Date.parse(note.createdAt);
    return text(
      `Noted #${note.id} on roadbook #${ride.id} "${ride.name}", ${clockAt(end - note.minutesBack * 60_000, timezone)}-${clockAt(end, timezone)}. It will be reviewed after the ride.`,
    );
  },
);

server.registerTool(
  "reviewRide",
  {
    description:
      "After a ride: place its pending notes on the road. With gpxPath (a track recorded by any app, as a GPX file on this machine), each note lands on the road actually ridden, detours of 2 km or more from the plan are listed, and the moving pace is compared with the plan; without it, notes are placed on the plan by elapsed time (approximate). Returns the stretches with a proposed rating each. Show the review as returned and ask the rider to confirm or change the ratings; then call again with decisions to store them. Stored road ratings steer future planning (0-1 avoided, 4-5 preferred).",
    annotations: hintsOf("reviewRide"),
    inputSchema: z.object({
      ride: z.string().optional().describe("Roadbook number or name; default the ride of the latest pending note"),
      gpxPath: z.string().optional().describe("Path of the recorded track on this machine"),
      decisions: z
        .array(
          z.object({
            noteId: z.number().int(),
            rating: z.number().int().min(0).max(5).optional().describe("Omit to keep the proposed rating"),
            dismiss: z.boolean().optional().describe("Drop the note without rating a road"),
          }),
        )
        .optional()
        .describe("The rider's confirmed ratings, after a first call without decisions"),
    }),
  },
  async (args) => {
    if (args.decisions) return text(applyReview(store, args.decisions).join("\n"));
    const ride = rideToReview(store, args.ride);
    const review = await reviewRide(store, ride, { track: args.gpxPath ? readTrack(args.gpxPath) : undefined });
    const form = canElicit() ? reviewForm(review) : null;
    if (!form) return text(formatReview(review));
    // The rider rates in the client's form; the model never rates on their behalf.
    const answer = await ask(form);
    if (!answer) {
      return text(
        `${formatReview(review)}\n\nThe rider closed the form: nothing stored, the notes stay pending. Do not rate them yourself.`,
      );
    }
    const stored = applyReview(store, reviewDecisions(review, answer));
    return text(`${formatReview(review)}\n\nThe rider's answers:\n${stored.join("\n") || "nothing rated"}`);
  },
);

server.registerTool(
  "rateRide",
  {
    description:
      "Rate a saved ride after riding it, or one of its legs: 0 (never again) to 5 (loved), with the rider's words as a note. Ratings steer later plans: rides and legs rated 4-5 are reused as building blocks, those rated 0-1 avoided. For a stretch of road within a leg, notes during the ride and reviewRide are more precise. Use the rider's own rating; ask when they gave none.",
    annotations: hintsOf("rateRide"),
    inputSchema: z.object({
      ride: z.string().describe("Roadbook number or name"),
      rating: z.number().int().min(0).max(5).describe("0 never again, 5 loved"),
      leg: z.number().int().min(1).optional().describe("Leg number, to rate one leg instead of the whole ride"),
      note: z.string().optional().describe("The rider's words, kept with the rating"),
    }),
  },
  async (args) => {
    const ride = store.findRide(args.ride);
    if (!ride) throw new Error(`No saved ride matches "${args.ride}". Call listRoadbooks.`);
    const note = args.note?.trim() || null;
    if (args.leg !== undefined) {
      if (!store.rateLeg(ride.id, args.leg, args.rating, note)) {
        throw new Error(`Roadbook #${ride.id} has no leg ${args.leg}; it has legs 1 to ${ride.legs.length}.`);
      }
    } else store.rateRide(ride.id, args.rating, note);
    // The next routed trip of this session must see the new rating.
    context.ratedRoads = undefined;
    const leg = args.leg === undefined ? undefined : ride.legs.find((l) => l.seq === args.leg);
    return text(
      `Rated ${leg ? `leg ${leg.seq} (${leg.from} -> ${leg.to}) of ` : ""}#${ride.id} "${ride.name}" ${args.rating}/5.`,
    );
  },
);

const page = z.number().int().min(1).optional().describe("Page to show, 20 lines each (default 1)");

server.registerTool(
  "listRoadbooks",
  {
    description:
      'The rider\'s roadbooks (saved loops and trips), newest first, 20 per page: number, name, distance, time, how many rides and the next planned date, rating. The last line says the page and how to get the next one: call again with that page when the rider asks for more. The number is what the rider calls "ride 7".',
    annotations: hintsOf("listRoadbooks"),
    inputSchema: z.object({ page }),
  },
  async (args) =>
    text(formatRoadbookPage(store.listRoadbooks(args.page ?? 1), (n) => `call listRoadbooks with page ${n}`)),
);

server.registerTool(
  "listRides",
  {
    description:
      "The rider's rides (a roadbook on a day), latest date first, rides with no date yet last, 20 per page: date, weekday, departure, roadbook number and name, distance, time, status (planned, ridden, cancelled). The last line says the page and how to get the next one: call again with that page when the rider asks for more. Use the roadbook number with showRide and the other ride tools.",
    annotations: hintsOf("listRides"),
    inputSchema: z.object({ page }),
  },
  async (args) => text(formatRideDayPage(store.listRideDays(args.page ?? 1), (n) => `call listRides with page ${n}`)),
);

// Read-only documents the rider can attach (in Claude Code: @ then ride:).
server.registerResource(
  "library",
  "ride://library",
  { title: "Saved rides", description: "The rider's library, one line per ride", mimeType: "text/plain" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: formatRideList(store.listRides()) }] }),
);
server.registerResource(
  "ride",
  new ResourceTemplate("ride://ride/{id}", {
    list: async () => ({
      resources: store
        .listRides()
        .map((r) => ({ uri: `ride://ride/${r.id}`, name: `#${r.id} ${r.name}`, mimeType: "text/plain" })),
    }),
  }),
  { title: "Saved ride", description: "Everything stored about one saved ride", mimeType: "text/plain" },
  async (uri, { id }) => {
    const ride = store.findRide(String(id));
    if (!ride) throw new Error(`No roadbook #${String(id)}`);
    return { contents: [{ uri: uri.href, mimeType: "text/plain", text: formatRideDetail(ride) }] };
  },
);
server.registerResource(
  "rated-roads",
  "ride://roads/rated",
  {
    title: "Rated roads",
    description: "Rides, legs and road stretches the rider rated: 0-1 avoided, 4-5 sought out",
    mimeType: "text/plain",
  },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: formatRatedRoads(store) }] }),
);

const RULES = `Use the agentMotoride tools for every lookup, never shell commands or web search. The settings below are the rider's defaults; when the request changes one (motorways allowed, other targets, repeats allowed), apply it with rideSettings before planning. Answer in plain text as laid out above, never JSON. Before presenting an itinerary, call checkItinerary and fix what it reports once. End an itinerary with one line "Route: <routeId>" naming the routed trip it describes, so the ride can be saved later. Save only when the rider asks, with saveRide and that routeId.`;
const userMessage = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});
/** Guidance for working on a saved ride: its data plus the rules for edits and questions. */
const editText = (saved: ReturnType<typeof store.findRide> & object, change: string) => {
  const data = {
    rideId: saved.id,
    name: saved.name,
    lastPlannedFor: saved.rideDate,
    departure: saved.departure,
    distanceKm: saved.distanceKm,
    ridingMinutes: saved.ridingMinutes,
    waypoints: saved.waypoints,
    roundTrip: saved.roundTrip,
    legs: saved.legs.map((l) => ({
      leg: l.seq,
      from: l.from,
      to: l.to,
      fromCoords: l.fromCoords,
      toCoords: l.toCoords,
      distanceKm: l.distanceKm,
      mainRoads: l.mainRoads,
      rating: l.rating,
      notes: l.notes,
    })),
    rating: saved.rating,
    notes: saved.notes,
    originalRequest: saved.request,
  };
  return planText(
    `${change}\n\nThis concerns roadbook #${saved.id} "${saved.name}". Work from its waypoints rather than searching for a new area. If the message asks for a change or a new date, route the ride again with calculateTrip, check the weather for that day, and apply the change, keeping everything else. If it is only a question, answer it from this data and the tools. Overlap with this ride is expected; use rideSettings to allow repeats if the duplicate check objects.\n${JSON.stringify(data)}`,
  );
};
const planText = (request: string, rules = RULES) =>
  `${SYSTEM_CORE}\n\n${rules}\n\n---\n\nRider's request: ${request}\n\n${settingsText()}`;
/** The guidance for a new ride: with API scouts off, how to scout with subagents. */
const newRideText = (request: string) => planText(request, scoutsOff ? `${RULES}\n\n${CLIENT_SCOUTS}` : RULES);

// Clients without prompt support (Codex) cannot use the slash commands below;
// this tool hands them the same text on request.
server.registerTool(
  "planningGuide",
  {
    description:
      "The full planning guidance for a new ride (how to search, what to check, how to lay out the itinerary), with the rider's request and current settings. Call it first whenever the rider asks for a new ride in plain words, whatever the client; then follow it. Not needed after the plan-ride command, which carries the same text. With a saved ride id, returns the guidance for editing that ride instead.",
    annotations: hintsOf("planningGuide"),
    inputSchema: z.object({
      request: z.string().describe("What the rider asked for, verbatim"),
      ride: z.string().optional().describe("Roadbook number or name, when the request is about an existing ride"),
    }),
  },
  async (args) => {
    if (args.ride) {
      const saved = store.findRide(args.ride);
      if (!saved) throw new Error(`No saved ride matches "${args.ride}". Call listRoadbooks.`);
      return text(editText(saved, args.request));
    }
    requests.push(args.request);
    usage.turns++;
    syncRun();
    return text(newRideText(args.request));
  },
);

// Prompts become slash commands in Claude Code (/mcp__ride__<name>). They are
// text only: the client's model reads them and decides which tools to call.
server.registerPrompt(
  "plan-ride",
  {
    title: "Plan a motorcycle ride",
    description: "Plan a one-day ride with the agentMotoride tools: what the rider wants, in one sentence.",
    argsSchema: { request: z.string().describe("e.g. this Saturday, no rain, under 250 km, winding roads") },
  },
  ({ request }) => {
    requests.push(request);
    usage.turns++;
    syncRun();
    return userMessage(newRideText(request));
  },
);

server.registerPrompt(
  "commute",
  {
    title: "Plan a practical trip",
    description:
      "Point to point, quickest sensible route, motorways permitted, with weather and traffic for the departure.",
    argsSchema: {
      destination: z.string().describe("Where to, e.g. Rue de la Loi, Brussels"),
      when: z.string().describe("Day and time, e.g. Monday 08:00, or 'arrive by 9:00 Monday'"),
      from: z.string().optional().describe("Start, default the rider's home"),
    },
  },
  ({ destination, when, from }) => {
    const request = `Practical trip${from ? ` from ${from}` : ""} to ${destination}, ${when}. Motorways permitted for this trip (set it with rideSettings). Give the route, distance, time with and without traffic, weather for the travel hours, arrival time and the map link.`;
    requests.push(request);
    usage.turns++;
    syncRun();
    return userMessage(planText(request));
  },
);

server.registerPrompt(
  "edit-ride",
  {
    title: "Edit a saved ride",
    description: "Load a saved ride and apply a change: new date, longer, skip a town, or just a question about it.",
    argsSchema: {
      ride: z.string().describe("Roadbook number or name"),
      change: z.string().describe("What to change or ask"),
    },
  },
  ({ ride, change }) => {
    const saved = store.findRide(ride);
    if (!saved) return userMessage(`No saved ride matches "${ride}". Call listRoadbooks to see the library.`);
    const request = editText(saved, change);
    requests.push(`edit #${saved.id}: ${change}`);
    usage.turns++;
    syncRun();
    return userMessage(request);
  },
);

server.registerPrompt(
  "save-ride",
  {
    title: "Save the current itinerary",
    description: "Store the itinerary on the table in the library, under a name.",
    argsSchema: { name: z.string().optional().describe("Ride name, default the itinerary's own") },
  },
  ({ name }) =>
    userMessage(
      `Save the itinerary currently on the table with saveRide: routeId from its "Route:" line${name ? `, name "${name}"` : ""}, the ride date and departure it states, the itinerary text as shown, and the request it answered. Then confirm the saved id. If no itinerary is on the table, say so.`,
    ),
);

server.registerPrompt(
  "export-gpx",
  {
    title: "Export GPX",
    description: "GPX file of the current itinerary or of a saved ride, for a GPS app.",
    argsSchema: { ride: z.string().optional().describe("Roadbook number or name; default the itinerary on the table") },
  },
  ({ ride }) =>
    userMessage(
      ride
        ? `Export saved ride "${ride}" as GPX with exportGpx (find its id with listRoadbooks if needed) and give the file path.`
        : `Export the itinerary on the table as GPX with exportGpx, using the routeId from its "Route:" line, and give the file path.`,
    ),
);

server.registerPrompt(
  "show-ride",
  {
    title: "Show a saved ride",
    description: "Everything stored about one ride: figures, daylight, cameras, stops, legs, itinerary.",
    argsSchema: { ride: z.string().describe("Roadbook number or name") },
  },
  ({ ride }) =>
    userMessage(
      `Call showRide for "${ride}" and show the result to the rider exactly as returned, in a code block, without reformatting or summarising it.`,
    ),
);

server.registerPrompt(
  "export-md",
  {
    title: "Export a ride as Markdown",
    description: "The ride's standard Markdown document, written to a file and shown.",
    argsSchema: {
      ride: z.string().describe("Roadbook number or name"),
      file: z.string().optional().describe("Destination path"),
    },
  },
  ({ ride, file }) =>
    userMessage(
      `Call exportMarkdown for "${ride}"${file ? ` with file "${file}"` : ""} and includeContent true. Tell the rider the path, then show the document exactly as returned, without reformatting.`,
    ),
);

server.registerPrompt(
  "today",
  {
    title: "Ride-day briefing",
    description: "Weather now, daylight, traffic, stops checked against opening hours, go or no-go for a saved ride.",
    argsSchema: { ride: z.string().optional().describe("Roadbook number or name; default the next dated ride") },
  },
  ({ ride }) =>
    userMessage(
      `Call rideBriefing${ride ? ` for "${ride}"` : ""} and show the result exactly as returned, in a code block. Then, in one or two sentences, say what you would do about any NO-GO or caution lines (a later departure, a different stop, another day), without calling other tools unless the rider asks.`,
    ),
);

server.registerPrompt(
  "refresh",
  {
    title: "Refresh a saved ride",
    description: "Recompute a ride's figures, weather, cameras, stops and stop plan, without changing the ride.",
    argsSchema: { ride: z.string().describe("Roadbook number or name") },
  },
  ({ ride }) =>
    userMessage(
      `Call refreshRide for "${ride}" and show the result exactly as returned, in a code block. Do not ask questions first and do not replan anything: a refresh keeps the ride as it is.`,
    ),
);

server.registerPrompt(
  "note",
  {
    title: "Note about the road just ridden",
    description: 'During the ride: "last 10 min awesome", "cobbles, never again". Reviewed after the ride.',
    argsSchema: { text: z.string().describe("What you want to remember about the last minutes") },
  },
  ({ text: note }) =>
    userMessage(
      `Call addRideNote with text "${note}" (a rating 0-5 only if these words give one explicitly) and confirm in one line. Nothing else.`,
    ),
);

server.registerPrompt(
  "review",
  {
    title: "Review a ride you rode",
    description: "Place your ride notes on the road ridden (recorded GPX track) or on the plan, then confirm ratings.",
    argsSchema: {
      gpxPath: z.string().optional().describe("Recorded track, GPX file on this machine"),
      ride: z.string().optional().describe("Roadbook number or name; default the ride with pending notes"),
    },
  },
  ({ gpxPath, ride }) =>
    userMessage(
      `Call reviewRide${ride ? ` for ride "${ride}"` : ""}${gpxPath ? ` with gpxPath "${gpxPath}"` : " without a track"} and show the result exactly as returned, in a code block. Then ask me to confirm the proposed ratings, change any, or dismiss notes. When I answer, call reviewRide again with the decisions and show what was stored.`,
    ),
);

server.registerPrompt(
  "list-rides",
  {
    title: "List rides",
    description: "The rider's rides by date, latest first, 20 per page.",
    argsSchema: { page: z.string().optional().describe("Page number, default 1") },
  },
  ({ page }) => userMessage(`Call listRides with page ${Number(page) || 1} and show the result as is.`),
);

server.registerPrompt(
  "plan-from",
  {
    title: "Plan a ride from a roadbook",
    description: "A ride from a saved roadbook on a day, without copying it: forecast, stops, verdict, links.",
    argsSchema: {
      roadbook: z.string().describe("Roadbook number or name"),
      day: z.string().describe("e.g. saturday, tomorrow, 2026-10-17"),
      time: z.string().optional().describe("Departure, e.g. 9:30"),
    },
  },
  ({ roadbook, day, time }) =>
    userMessage(
      `Call planRide with roadbook ${JSON.stringify(roadbook)}, date ${JSON.stringify(day)}${time ? `, departure ${JSON.stringify(time)}` : ""}, and show the result as is.`,
    ),
);

server.registerPrompt(
  "list-roadbooks",
  {
    title: "List roadbooks",
    description: "The rider's saved loops and trips, newest first, 20 per page.",
    argsSchema: { page: z.string().optional().describe("Page number, default 1") },
  },
  ({ page }) => userMessage(`Call listRoadbooks with page ${Number(page) || 1} and show the result as is.`),
);

server.registerPrompt(
  "help",
  {
    title: "What the ride server can do",
    description: "Commands and tools of agentMotoride, no tool call.",
    argsSchema: {},
  },
  () =>
    userMessage(`Show the rider this text as is, without calling any tool:

agentMotoride commands (slash commands):
  /mcp__ride__plan-ride <request>        plan a new leisure ride (scouts, weather, roads, slow zones, cameras, stops)
  /mcp__ride__commute <destination> <when> [from]   practical trip, motorways permitted, traffic checked
  /mcp__ride__edit-ride <id|name> <change>          change or question a saved ride
  /mcp__ride__save-ride [name]           save the itinerary on the table
  /mcp__ride__export-gpx [id|name]       GPX file for a GPS app
  /mcp__ride__export-md <id|name> [file] Markdown document of a ride, the standard full view
  /mcp__ride__show-ride <id|name>        everything stored about one ride (daylight, cameras, stops, legs)
  /mcp__ride__today [id|name]            ride-day briefing: weather now, daylight, traffic, stops open or not, go/no-go
  /mcp__ride__refresh <id|name>          recompute a ride: figures, weather, cameras, stops, stop plan (no replanning)
  /mcp__ride__list-roadbooks [page]      the saved loops and trips, 20 per page
  /mcp__ride__list-rides [page]          the rides by date, latest first, 20 per page
  /mcp__ride__plan-from <roadbook> <day> [time]  a ride from a saved roadbook on a day, no copy (also in words: "plan a ride from roadbook 7 on Saturday at 9")
  /mcp__ride__note <text>                during the ride: a note about the last 10 minutes ("awesome", "never again")
  /mcp__ride__review [gpxPath] [ride]    after the ride: notes placed on the recorded track, detours, pace, confirm ratings
  /mcp__ride__help                       this text

Attach a saved ride with @ in the prompt: @ride:ride://library, @ride:ride://ride/<id>, @ride:ride://roads/rated.
Things to say in plain words: "show me ride 7 on a map", "rate ride 7 five, superb", "leg 2 of ride 7: never again, gravel", "import ~/Downloads/route.gpx", "allow motorways", "no repeats of saved rides", "aim for 10% in 50 zones" (settings), "where are the speed cameras", "find a fuel stop and a café", "when does the sun set".
Outside Claude Code: npm run rides -- roadbooks | rides | show | rate | note | review | import | export | qr | share | trace | runs.

Current settings:
${settingsText()}`),
);

if (process.env.RIDE_HOME) {
  try {
    await setHome(process.env.RIDE_HOME);
  } catch (error) {
    process.stderr.write(`RIDE_HOME could not be resolved: ${error instanceof Error ? error.message : error}\n`);
  }
}
await server.connect(new StdioServerTransport());
process.stderr.write(`agentMotoride MCP server ready (start: ${context.home.label || "not set"}, run #${runId})\n`);
