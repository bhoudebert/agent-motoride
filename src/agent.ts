import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PREFERENCES, type RidePreferences } from "./preferences.ts";
import type { RegisteredRoute, RideContext } from "./session.ts";
import type { SavedRide, Store } from "./store.ts";
import { setGeoAnchor } from "./tools/geo.ts";
import { createTools } from "./tools/index.ts";
import type { RunUsage } from "./usage.ts";

export interface RideRequest {
  home: string;
  store: Store;
  preferences?: RidePreferences;
  /** Allow rides that repeat saved ones. */
  allowRepeat?: boolean;
  /** A saved ride to evolve instead of planning from scratch. */
  baseRide?: SavedRide;
  now?: Date;
}

/** The itinerary currently on the table, tied to the routed trip it describes. */
export interface CurrentRide {
  route: RegisteredRoute;
  rideDate: string | null;
  departure: string | null;
  title: string;
  itinerary: string;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const MODEL = process.env.RIDE_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.RIDE_EFFORT || "high") as Effort;
// Haiku 4.5 predates adaptive thinking and the effort setting: it takes a fixed
// thinking budget instead, and has no refusal-fallback route.
const LEGACY_THINKING = MODEL.startsWith("claude-haiku");

/** Request settings that depend on the model generation. */
function modelSettings() {
  if (LEGACY_THINKING) {
    return { thinking: { type: "enabled" as const, budget_tokens: 4000 } };
  }
  return {
    thinking: { type: "adaptive" as const },
    output_config: { effort: EFFORT },
    // If a safety classifier declines the request, the API re-runs it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}
const MAX_ITERATIONS = 40;

const SYSTEM = `You plan one-day motorcycle rides for a rider who wants an itinerary they can follow tomorrow morning.

You work from real data, gathered with your tools: road geometry from OpenStreetMap, routed distances and times, hourly forecasts, and traffic when a source is configured. You decide where to look. Typically that means picking a few promising riding areas within reach of the rider's start point, finding winding roads there, assembling a loop, routing it to get the true distance, and checking the weather at the start, along the route and on the way back for the hours the rider would be at each place. If the weather or the distance rules an area out, try another one. Independent lookups can be issued together in one turn.

What makes a good ride here is open road: time spent outside towns and villages, on roads that bend, and never on motorways. Every routed trip reports openRoadPct, the share of its distance outside built-up areas and off motorways, next to the share in zones limited to 30 km/h or less and to 31-50 km/h. Slow zones cannot be avoided completely, since every ride leaves a town and crosses villages; the job is to keep them as small as the terrain allows. The rider's percentages are targets to aim for, not pass/fail limits. Among loops that satisfy the hard constraints, prefer the one with the most open road, and when a loop is over a target, look at where its longest 30 and 50 stretches are and move or drop waypoints so the route skirts town centres instead of crossing them, then route it again. Do this before settling, and do not give up a clearly better riding area just to shave a point of slow zone. Limits come from OpenStreetMap; untagged stretches are classed by whether they lie in a built-up area.

Riding time is estimated per road segment from its speed limit and how much it bends, without stops or traffic. Judge time constraints against that estimate. The router's own time is also returned as an upper bound; it is pessimistic and is not the figure to plan with.

Plan on road data first. Traffic comes last: once a loop is chosen, run that final loop through the traffic check for the planned departure to see how much longer it would take, report the result next to the road-data estimate, and reconsider the departure time or the loop only if the delay is substantial.

Not every request is a leisure ride. When the rider asks for a practical trip, such as getting to work or reaching a place by a given time, plan it as one: point to point unless they say otherwise, the quickest sensible route, on motorways when the rider permits them (route it with motorways allowed, and compare with the motorway-free route if the difference is worth showing). Skip the search for winding roads, and do not optimise open road or slow zones; report them briefly. Check the weather for the travel hours and the traffic for the departure time, since a commute lives or dies by traffic, and give the arrival time. Saved-ride overlap does not matter for such a trip: repeating a commute is the point. The itinerary is shorter: route, distance, time with and without traffic, weather, link, and the reference line.

The rider keeps a library of saved rides, and each ride and leg may carry a rating from 1 to 5 given after riding it. Look at the library once at the start. Legs rated 4 or 5 are proven: reuse them as building blocks when they fit, since their coordinates go straight into a route. Stay off roads from rides or legs rated 1 or 2. The rider saves rides so that the next one is different: every routed trip comes back with a verdict comparing it with the saved rides, and a trip marked DUPLICATE is not a valid proposal unless the rider asked for that ride or a variant of it; choose other roads or another area. A trip marked similar is fine, and worth a mention. Saved data replaces road discovery only: weather is always checked fresh for the day in question.

The rider's constraints are hard limits: a ride described as dry must be dry along the whole loop for the riding hours, and a distance cap applies to the routed total including getting there and back. If nothing satisfies every constraint, say so and offer the closest option, naming which constraint it breaks and by how much.

Only state what the tools returned. If a tool fails or has no data source, say that part is unverified rather than filling it in from general knowledge. Road refs, distances, times and forecasts in the answer must come from tool results.

Finish with the itinerary in plain text for a terminal:
- one line naming the ride and why it was picked
- departure time, total distance, estimated riding time, average riding speed, and a realistic total with breaks
- open-road share, motorway use (should be none), and the share of distance in zones of 30 km/h or less and of 31-50 km/h against the rider's targets
- numbered legs: road refs, towns passed, leg distance, riding time and average speed, what makes the leg worth riding
- weather along the route by time of day
- traffic for the planned departure: expected delay and the resulting time, or a note that it was not checked
- the Google Maps link from the final routed loop
- one alternative in a sentence or two, if you evaluated one

Every answer that presents an itinerary ends with exactly one reference line, which the program reads when the rider saves the ride:
Ride ref: <routeId> | <YYYY-MM-DD> | <HH:MM> | <short ride name>
The routeId is the one returned by the routing call for the exact loop the itinerary describes, the date and time are the ride day and departure, and the name is a few words a rider would recognise the ride by. The legs, distance and link in the itinerary must be those of that routed trip.

The rider may then ask for changes. Treat a follow-up as an edit of the current itinerary: keep what they did not ask to change, reuse lookups you already have, and call tools again for anything the change affects (a new loop must be routed again, new places need their forecast). Answer with the full updated itinerary in the same format, opening with one line on what changed. If the follow-up is a question rather than a change, just answer it.`;

function describePreferences(p: RidePreferences): string {
  return [
    p.avoidMotorways
      ? "- Motorways (autoroutes): never. This is a hard limit, including on the way out and back."
      : "- Motorways (autoroutes): permitted. For a leisure ride, use them only to get to and from the riding area, never for the ride itself. For a practical trip, use them freely.",
    "- Goal: as much riding as possible on open road outside towns and villages.",
    `- Zones limited to 30 km/h or less: minimise, aim for at most ${p.max30Pct}% of the distance.`,
    `- Zones limited to 31-50 km/h: fine to get through a town, minimise overall, aim for at most ${p.max50Pct}% of the distance.`,
  ].join("\n");
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Tolerates markdown decoration (bold, backticks, quote marks) around the line.
const RIDE_REF = /^[\s*`>_-]*Ride ref:[\s*`]*(r\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})?\s*\|\s*(\d{1,2}:\d{2})?\s*\|\s*(.+?)[\s*`_]*$/m;

function describeBaseRide(ride: SavedRide): string {
  const data = {
    rideId: ride.id,
    name: ride.name,
    lastPlannedFor: ride.rideDate,
    departure: ride.departure,
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
    originalRequest: ride.request,
  };
  return `This session evolves saved ride #${ride.id} "${ride.name}". Work from its waypoints rather than searching for a new area. If the message above asks for a change or a new date, route the ride again to get a route ID for this session, check the weather for the day in question, and apply the request, changing only what it asks for. If it is only a question about the ride, answer it from this data and the tools, without replanning. Overlap with this ride is expected.\n${JSON.stringify(data)}`;
}

export interface RideSession {
  /** Shared state; `context.preferences` may be changed between messages. */
  context: RideContext;
  /** Send the next message (a refinement of the previous itinerary) and print the answer. */
  send(text: string): Promise<void>;
  /** The latest itinerary that can be saved, if the model has produced one. */
  current(): CurrentRide | undefined;
  /** Model, effort, tokens and time consumed by this session so far. */
  usage(): RunUsage;
}

/** Plan a ride from a request: opens a session and sends the request. */
export async function startRide(request: RideRequest & { prompt: string }): Promise<RideSession> {
  const session = await openRide(request);
  await session.send(request.prompt);
  return session;
}

/**
 * Open a session without calling the model: nothing is sent until the first
 * `send`. The session keeps the whole conversation, tool results included, so
 * follow-ups such as "shorter" or "skip Die" build on what was already looked up.
 * With `baseRide`, the first message works on that saved ride.
 */
export async function openRide(request: RideRequest): Promise<RideSession> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("No Claude credentials: copy .env.example to .env and set ANTHROPIC_API_KEY.");
  }
  const client = new Anthropic();
  // Resolve the start point first: it fails fast on a typo and anchors later place-name lookups.
  const start = await setGeoAnchor(request.home);
  const now = request.now ?? new Date();
  const preferences = request.preferences ?? DEFAULT_PREFERENCES;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const context: RideContext = {
    store: request.store,
    preferences,
    home: start,
    allowRepeat: request.allowRepeat ?? false,
    lineage: new Set(request.baseRide ? [request.baseRide.id] : []),
    routes: new Map(),
  };
  // Copied, so a mid-session switch does not leak into the caller's object.
  context.preferences = { ...preferences };
  const tools = createTools(context);
  let history: Anthropic.Beta.BetaMessageParam[] = [];
  const usage: RunUsage = {
    model: MODEL,
    effort: LEGACY_THINKING ? "n/a" : EFFORT,
    turns: 0,
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    seconds: 0,
  };
  let current: CurrentRide | undefined;

  async function send(text: string): Promise<void> {
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      ...modelSettings(),
      // Cache the growing conversation so each round and each follow-up re-reads it cheaply.
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      tools,
      max_iterations: MAX_ITERATIONS,
      // The runner appends to this array; history is only replaced once the turn succeeds.
      messages: [...history, { role: "user", content: text }],
    });

    let last: Anthropic.Beta.BetaMessage | undefined;
    const before = { ...usage };
    const started = Date.now();
    usage.turns++;
    try {
      for await (const message of runner) {
        last = message;
        usage.modelCalls++;
        usage.inputTokens += message.usage.input_tokens;
        usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
        usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
        usage.outputTokens += message.usage.output_tokens;
        for (const block of message.content) {
          if (block.type === "tool_use") usage.toolCalls++;
          if (block.type === "text" && block.text.trim()) console.log(`\n${block.text.trim()}`);
        }
      }
    } finally {
      // Counted even when the turn fails: failed attempts cost tokens too.
      usage.seconds += (Date.now() - started) / 1000;
    }

    process.stderr.write(
      `\x1b[2m\n[${MODEL}, ${usage.inputTokens + usage.cacheWriteTokens - before.inputTokens - before.cacheWriteTokens} tokens in, ${usage.cacheReadTokens - before.cacheReadTokens} read from cache, ${usage.outputTokens - before.outputTokens} out]\x1b[0m\n`,
    );
    switch (last?.stop_reason) {
      case "end_turn": {
        // Keep every block as returned (thinking included): the API requires them unchanged.
        const messages = [...runner.params.messages];
        if (messages.at(-1)?.role !== "assistant") messages.push({ role: "assistant", content: last.content });
        history = messages;

        // An answer carrying a reference line is a new itinerary; anything else
        // (a plain answer to a question) leaves the current one in place.
        const answer = last.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
        const ref = RIDE_REF.exec(answer);
        const route = ref && context.routes.get(ref[1]!);
        if (ref && route) {
          current = { route, rideDate: ref[2] ?? null, departure: ref[3] ?? null, title: ref[4]!, itinerary: answer };
        }
        return;
      }
      case "refusal":
        throw new Error(`The model declined the request (${last.stop_details?.category ?? "no category"}).`);
      case "max_tokens":
        throw new Error("The answer was cut off at the output limit; the itinerary above is incomplete.");
      case "tool_use":
        throw new Error(`Stopped after ${MAX_ITERATIONS} tool rounds without a final itinerary.`);
      default:
        throw new Error(`Unexpected stop: ${last?.stop_reason ?? "no response"}`);
    }
  }

  // Context the model needs once, attached to whatever the rider says first.
  // Settings are read at that moment, so a switch made before it is honoured.
  let opened = false;
  async function sendWithContext(text: string): Promise<void> {
    if (opened) return send(text);
    const repeatRule = context.allowRepeat ? "\nRepeating saved rides is allowed this time." : "";
    const base = request.baseRide ? `\n\n${describeBaseRide(request.baseRide)}` : "";
    await send(
      `${text}\n\nStart and end point: ${request.home} (${start.label}, ${start.lat},${start.lon})\nRoad preferences:\n${describePreferences(context.preferences)}${repeatRule}\nToday is ${WEEKDAYS[now.getDay()]} ${today}.${base}`,
    );
    opened = true;
  }
  return { context, send: sendWithContext, current: () => current, usage: () => ({ ...usage }) };
}
