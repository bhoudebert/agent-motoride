// MCP server: exposes the ride tools to any Model Context Protocol client
// (Claude Code, Claude desktop, other agents). The client's own model does the
// planning; this process provides tools, state and the planning prompt.
// Standard output carries the protocol, so all logging goes to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SYSTEM_CORE, describeSituation } from "./agent.ts";
import { exportSavedRide, writeGpx } from "./gpx.ts";
import { enrichRide, formatRideDetail, formatRideList, saveCurrentRide } from "./library.ts";
import { SCOUT_MODEL } from "./model.ts";
import { formatRideMarkdown, writeRideMarkdown } from "./markdown.ts";
import { preferencesFromEnv } from "./preferences.ts";
import type { RideContext } from "./session.ts";
import { Store } from "./store.ts";
import { setGeoAnchor, usePersistentGeoCache } from "./tools/geo.ts";
import { createToolDefinitions } from "./tools/index.ts";
import { emptyUsage, estimateCostUsd } from "./usage.ts";

const store = new Store();
// Place names for coordinates never change: keep them across sessions.
usePersistentGeoCache({
  get: (key) => store.cacheGet<string>(key),
  set: (key, value) => store.cacheSet(key, "reverseGeocode", value, 365 * 24 * 3_600_000),
});
const usage = emptyUsage("mcp-client", "n/a");
const runId = store.startRun({ home: process.env.RIDE_HOME ?? "", request: "mcp session", usage, costUsd: null, result: null, rideId: null, error: null });

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
    | { openRoadPct?: number; limit31to50?: { pct: number }; limit30OrLess?: { pct: number }; motorwayKm?: number; timeOnRoads70PlusPct?: number }
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

const settingsText = () =>
  `${describeSituation(homeInput, context.home.label ? context.home : undefined, context.preferences)}\nSaved rides: ${store.listRides().length}. Trace run id: ${runId}.`;

const server = new McpServer({ name: "agentRide", version: "0.1.0" });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] });

// The ride tools, shared with the API planner. Each call is traced and counted.
for (const tool of createToolDefinitions(context, { scouts: true })) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema },
    async (args: unknown) => {
      if (!context.home.label) throw new Error("No start point yet: call rideSettings with the rider's home first.");
      usage.toolCalls++;
      const result = await tool.run(args);
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
    inputSchema: z.object({
      home: z.string().optional().describe('Start and end point: town, address or "lat,lon"'),
      allowMotorways: z.boolean().optional(),
      max30Pct: z.number().min(0).max(100).optional(),
      max50Pct: z.number().min(0).max(100).optional(),
      allowRepeat: z.boolean().optional().describe("Accept rides that repeat saved ones"),
    }),
  },
  async (args) => {
    if (args.home) await setHome(args.home);
    if (args.allowMotorways !== undefined) context.preferences.avoidMotorways = !args.allowMotorways;
    if (args.max30Pct !== undefined) context.preferences.max30Pct = args.max30Pct;
    if (args.max50Pct !== undefined) context.preferences.max50Pct = args.max50Pct;
    if (args.allowRepeat !== undefined) context.allowRepeat = args.allowRepeat;
    return text(settingsText());
  },
);

server.registerTool(
  "saveRide",
  {
    description:
      "Save an itinerary to the rider's library. Only when the rider asks to save. routeId must be one returned by calculateTrip in this session; the saved distances and geometry come from that routed trip. Returns the saved ride id.",
    inputSchema: z.object({
      routeId: z.string(),
      name: z.string().describe("A few words a rider would recognise the ride by"),
      rideDate: z.string().nullable().describe("YYYY-MM-DD or null"),
      departure: z.string().nullable().describe("HH:MM or null"),
      itinerary: z.string().describe("The itinerary text as presented to the rider"),
      request: z.string().describe("What the rider asked for, in one line"),
    }),
  },
  async (args) => {
    const route = context.routes.get(args.routeId);
    if (!route) throw new Error(`Unknown routeId ${args.routeId}; it must come from calculateTrip in this session.`);
    const id = saveCurrentRide(
      context,
      { route, rideDate: args.rideDate, departure: args.departure, title: args.name, itinerary: args.itinerary },
      { name: args.name, request: args.request, parentId: lastSavedId, home: homeInput, usage },
    );
    lastSavedId = id;
    lastRouteId = args.routeId;
    syncRun();
    void enrichRide(store, store.findRide(String(id))!).catch(() => undefined);
    return text(`Saved as ride #${id} "${args.name}". Export with exportGpx, or: npm run rides -- show ${id}`);
  },
);

server.registerTool(
  "exportGpx",
  {
    description: "Write a ride as a GPX file for a GPS app: either a routeId from this session or the id of a saved ride. Returns the file path.",
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
      if (!ride) throw new Error(`No saved ride #${args.rideId}`);
      const { path } = await exportSavedRide(store, ride, args.file);
      return text(`GPX written: ${path}`);
    }
    const route = args.routeId ? context.routes.get(args.routeId) : undefined;
    if (!route) throw new Error("Give a routeId from calculateTrip in this session, or a saved rideId.");
    const { trip } = route;
    const path = writeGpx(
      {
        name: args.name ?? `Ride ${route.id}`,
        description: `${trip.result.totalDistanceKm} km, about ${trip.result.totalRidingTime} riding. Planned with agentRide.`,
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
  "showRide",
  {
    description:
      "Full view of one saved ride, as the rider sees it in the app: figures, road mix, time at 70+, daylight, fixed cameras, fuel and café stops, legs with names, main roads, times and ratings, map link and the itinerary text. Show it to the rider as is; do not rebuild it from other tools.",
    inputSchema: z.object({ ride: z.string().describe("Saved ride id or name") }),
  },
  async (args) => {
    const ride = store.findRide(args.ride);
    if (!ride) throw new Error(`No saved ride matches "${args.ride}". Call listRides.`);
    return text(formatRideDetail(ride));
  },
);

server.registerTool(
  "exportMarkdown",
  {
    description:
      "Write a saved ride as a Markdown document in the app's standard layout (figures, road mix, legs table, daylight, cameras, stops, itinerary), for versioning elsewhere. Returns the file path, and the document itself when asked.",
    inputSchema: z.object({
      ride: z.string().describe("Saved ride id or name"),
      file: z.string().optional().describe("Destination path; default exports/ in the project"),
      includeContent: z.boolean().optional().describe("Also return the Markdown text, default false"),
    }),
  },
  async (args) => {
    const ride = store.findRide(args.ride);
    if (!ride) throw new Error(`No saved ride matches "${args.ride}". Call listRides.`);
    const path = writeRideMarkdown(ride, args.file);
    return text(args.includeContent ? `Markdown written: ${path}\n\n${formatRideMarkdown(ride)}` : `Markdown written: ${path}`);
  },
);

server.registerTool(
  "listRides",
  { description: "The rider's saved rides, one line each (id, name, distance, time, date, rating).", inputSchema: z.object({}) },
  async () => text(formatRideList(store.listRides())),
);

// Prompts become slash commands in Claude Code (/mcp__ride__<name>). They are
// text only: the client's model reads them and decides which tools to call.
const RULES = `Use the agentRide tools for every lookup, never shell commands or web search. The settings below are the rider's defaults; when the request changes one (motorways allowed, other targets, repeats allowed), apply it with rideSettings before planning. Answer in plain text as laid out above, never JSON. End an itinerary with one line "Route: <routeId>" naming the routed trip it describes, so the ride can be saved later. Save only when the rider asks, with saveRide and that routeId.`;
const userMessage = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });
const planText = (request: string) => `${SYSTEM_CORE}\n\n${RULES}\n\n---\n\nRider's request: ${request}\n\n${settingsText()}`;

server.registerPrompt(
  "plan-ride",
  {
    title: "Plan a motorcycle ride",
    description: "Plan a one-day ride with the agentRide tools: what the rider wants, in one sentence.",
    argsSchema: { request: z.string().describe("e.g. this Saturday, no rain, under 250 km, winding roads") },
  },
  ({ request }) => {
    requests.push(request);
    usage.turns++;
    syncRun();
    return userMessage(planText(request));
  },
);

server.registerPrompt(
  "commute",
  {
    title: "Plan a practical trip",
    description: "Point to point, quickest sensible route, motorways permitted, with weather and traffic for the departure.",
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
    argsSchema: { ride: z.string().describe("Saved ride id or name"), change: z.string().describe("What to change or ask") },
  },
  ({ ride, change }) => {
    const saved = store.findRide(ride);
    if (!saved) return userMessage(`No saved ride matches "${ride}". Call listRides to see the library.`);
    const data = {
      rideId: saved.id,
      name: saved.name,
      lastPlannedFor: saved.rideDate,
      departure: saved.departure,
      distanceKm: saved.distanceKm,
      ridingMinutes: saved.ridingMinutes,
      waypoints: saved.waypoints,
      roundTrip: saved.roundTrip,
      legs: saved.legs.map((l) => ({ leg: l.seq, from: l.from, to: l.to, fromCoords: l.fromCoords, toCoords: l.toCoords, distanceKm: l.distanceKm, mainRoads: l.mainRoads, rating: l.rating, notes: l.notes })),
      rating: saved.rating,
      notes: saved.notes,
      originalRequest: saved.request,
    };
    const request = `${change}\n\nThis concerns saved ride #${saved.id} "${saved.name}". Work from its waypoints rather than searching for a new area. If the message asks for a change or a new date, route the ride again with calculateTrip, check the weather for that day, and apply the change, keeping everything else. If it is only a question, answer it from this data and the tools. Overlap with this ride is expected; use rideSettings to allow repeats if the duplicate check objects.\n${JSON.stringify(data)}`;
    requests.push(`edit #${saved.id}: ${change}`);
    usage.turns++;
    syncRun();
    return userMessage(planText(request));
  },
);

server.registerPrompt(
  "save-ride",
  { title: "Save the current itinerary", description: "Store the itinerary on the table in the library, under a name.", argsSchema: { name: z.string().optional().describe("Ride name, default the itinerary's own") } },
  ({ name }) => userMessage(`Save the itinerary currently on the table with saveRide: routeId from its "Route:" line${name ? `, name "${name}"` : ""}, the ride date and departure it states, the itinerary text as shown, and the request it answered. Then confirm the saved id. If no itinerary is on the table, say so.`),
);

server.registerPrompt(
  "export-gpx",
  { title: "Export GPX", description: "GPX file of the current itinerary or of a saved ride, for a GPS app.", argsSchema: { ride: z.string().optional().describe("Saved ride id or name; default the itinerary on the table") } },
  ({ ride }) => userMessage(ride ? `Export saved ride "${ride}" as GPX with exportGpx (find its id with listRides if needed) and give the file path.` : `Export the itinerary on the table as GPX with exportGpx, using the routeId from its "Route:" line, and give the file path.`),
);

server.registerPrompt(
  "show-ride",
  { title: "Show a saved ride", description: "Everything stored about one ride: figures, daylight, cameras, stops, legs, itinerary.", argsSchema: { ride: z.string().describe("Saved ride id or name") } },
  ({ ride }) => userMessage(`Call showRide for "${ride}" and show the result to the rider exactly as returned, in a code block, without reformatting or summarising it.`),
);

server.registerPrompt(
  "export-md",
  { title: "Export a ride as Markdown", description: "The ride's standard Markdown document, written to a file and shown.", argsSchema: { ride: z.string().describe("Saved ride id or name"), file: z.string().optional().describe("Destination path") } },
  ({ ride, file }) => userMessage(`Call exportMarkdown for "${ride}"${file ? ` with file "${file}"` : ""} and includeContent true. Tell the rider the path, then show the document exactly as returned, without reformatting.`),
);

server.registerPrompt(
  "list-rides",
  { title: "List saved rides", description: "The rider's library, one line per ride.", argsSchema: {} },
  () => userMessage("Call listRides and show the result as is."),
);

server.registerPrompt(
  "help",
  { title: "What the ride server can do", description: "Commands and tools of agentRide, no tool call.", argsSchema: {} },
  () =>
    userMessage(`Show the rider this text as is, without calling any tool:

agentRide commands (slash commands):
  /mcp__ride__plan-ride <request>        plan a new leisure ride (scouts, weather, roads, slow zones, cameras, stops)
  /mcp__ride__commute <destination> <when> [from]   practical trip, motorways permitted, traffic checked
  /mcp__ride__edit-ride <id|name> <change>          change or question a saved ride
  /mcp__ride__save-ride [name]           save the itinerary on the table
  /mcp__ride__export-gpx [id|name]       GPX file for a GPS app
  /mcp__ride__export-md <id|name> [file] Markdown document of a ride, the standard full view
  /mcp__ride__show-ride <id|name>        everything stored about one ride (daylight, cameras, stops, legs)
  /mcp__ride__list-rides                 the library
  /mcp__ride__help                       this text

Things to say in plain words: "allow motorways", "no repeats of saved rides", "aim for 10% in 50 zones" (settings), "where are the speed cameras", "find a fuel stop and a café", "when does the sun set".
Outside Claude Code: npm run rides -- list | show | rate | export | qr | share | trace | runs.

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
process.stderr.write(`agentRide MCP server ready (start: ${context.home.label || "not set"}, run #${runId})\n`);
