// MCP server: exposes the ride tools to any Model Context Protocol client
// (Claude Code, Claude desktop, other agents). The client's own model does the
// planning; this process provides tools, state and the planning prompt.
// Standard output carries the protocol, so all logging goes to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SYSTEM_CORE, describePreferences } from "./agent.ts";
import { exportSavedRide, writeGpx } from "./gpx.ts";
import { formatRideList, saveCurrentRide } from "./library.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";
import type { RideContext } from "./session.ts";
import { Store } from "./store.ts";
import { setGeoAnchor } from "./tools/geo.ts";
import { createToolDefinitions } from "./tools/index.ts";
import type { RunUsage } from "./usage.ts";

const store = new Store();
const usage: RunUsage = {
  model: "mcp-client",
  effort: "n/a",
  turns: 0,
  modelCalls: 0,
  toolCalls: 0,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  seconds: 0,
};
const runId = store.startRun({ home: process.env.RIDE_HOME ?? "", request: "mcp session", usage, costUsd: null, result: null, rideId: null, error: null });

const context: RideContext = {
  store,
  preferences: {
    ...DEFAULT_PREFERENCES,
    avoidMotorways: !["1", "true"].includes(process.env.RIDE_ALLOW_MOTORWAYS ?? ""),
    max30Pct: Number(process.env.RIDE_MAX_30_PCT) || DEFAULT_PREFERENCES.max30Pct,
    max50Pct: Number(process.env.RIDE_MAX_50_PCT) || DEFAULT_PREFERENCES.max50Pct,
  },
  // Placeholder until a start point is set; tools refuse to run before that.
  home: { lat: 0, lon: 0, label: "" },
  allowRepeat: false,
  lineage: new Set(),
  routes: new Map(),
  runId,
  usage,
  trace: (event) => store.addTrace(runId, event),
};
let homeInput = "";
let lastSavedId: number | null = null;

async function setHome(location: string): Promise<string> {
  const point = await setGeoAnchor(location);
  context.home = point;
  homeInput = location;
  store.updateRun(runId, { home: location, request: "mcp session", usage, costUsd: null, result: null, rideId: lastSavedId, error: null });
  return point.label;
}

const settingsText = () =>
  [
    `Start and end point: ${context.home.label || "NOT SET (call rideSettings with home)"}`,
    `Road preferences:\n${describePreferences(context.preferences)}`,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Saved rides: ${store.listRides().length}. Trace run id: ${runId}.`,
  ].join("\n");

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
      store.updateRun(runId, { home: homeInput, request: "mcp session", usage, costUsd: null, result: null, rideId: lastSavedId, error: null });
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
    store.updateRun(runId, { home: homeInput, request: args.request, usage, costUsd: null, result: null, rideId: id, error: null });
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
  "listRides",
  { description: "The rider's saved rides, one line each (id, name, distance, time, date, rating).", inputSchema: z.object({}) },
  async () => text(formatRideList(store.listRides())),
);

// The planning prompt, so the client's model plans the way the built-in planner does.
server.registerPrompt(
  "plan-ride",
  {
    title: "Plan a motorcycle ride",
    description: "Plan a one-day ride with the agentRide tools: what the rider wants, in one sentence.",
    argsSchema: { request: z.string().describe("e.g. this Saturday, no rain, under 250 km, winding roads") },
  },
  ({ request }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `${SYSTEM_CORE}\n\nUse the agentRide tools for every lookup, never shell commands or web search. The settings below are the rider's defaults; when the request changes one (motorways allowed, other targets, repeats allowed), apply it with rideSettings before planning. Answer in plain text as laid out above, never JSON. End the itinerary with one line "Route: <routeId>" naming the routed trip it describes, so the ride can be saved later. Save only when the rider asks, with saveRide and that routeId.\n\n---\n\nRider's request: ${request}\n\n${settingsText()}`,
        },
      },
    ],
  }),
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
