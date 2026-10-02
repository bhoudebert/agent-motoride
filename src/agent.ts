import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PREFERENCES, type RidePreferences } from "./preferences.ts";
import type { RegisteredRoute, RideContext } from "./session.ts";
import type { SavedRide, Store } from "./store.ts";
import { setGeoAnchor } from "./tools/geo.ts";
import { createTools } from "./tools/index.ts";

export interface RideRequest {
  prompt: string;
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

const MODEL = process.env.RIDE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.RIDE_EFFORT ?? "high") as Effort;
const MAX_ITERATIONS = 40;

const SYSTEM = `You plan one-day motorcycle rides for a rider who wants an itinerary they can follow tomorrow morning.

You work from real data, gathered with your tools: road geometry from OpenStreetMap, routed distances and times, hourly forecasts, and traffic when a source is configured. You decide where to look. Typically that means picking a few promising riding areas within reach of the rider's start point, finding winding roads there, assembling a loop, routing it to get the true distance, and checking the weather at the start, along the route and on the way back for the hours the rider would be at each place. If the weather or the distance rules an area out, try another one. Independent lookups can be issued together in one turn.

Slow zones spoil a ride. Every routed trip reports how much of it is posted at 30 km/h or less and at 31-50 km/h. When a loop exceeds the rider's targets, look at where the slow stretches are and move or drop waypoints so the route skirts town and village centres instead of crossing them, then route it again. Passing through a few villages is normal; a ride that crawls from town to town is not what was asked for. Speed limits come from OpenStreetMap tags and are incomplete, so present the shares as "posted" figures.

The rider keeps a library of saved rides, and each ride and leg may carry a rating from 1 to 5 given after riding it. Look at the library once at the start. Legs rated 4 or 5 are proven: reuse them as building blocks when they fit, since their coordinates go straight into a route. Stay off roads from rides or legs rated 1 or 2. The rider saves rides so that the next one is different: every routed trip comes back with a verdict comparing it with the saved rides, and a trip marked DUPLICATE is not a valid proposal unless the rider asked for that ride or a variant of it; choose other roads or another area. A trip marked similar is fine, and worth a mention. Saved data replaces road discovery only: weather is always checked fresh for the day in question.

The rider's constraints are hard limits: a ride described as dry must be dry along the whole loop for the riding hours, and a distance cap applies to the routed total including getting there and back. If nothing satisfies every constraint, say so and offer the closest option, naming which constraint it breaks and by how much.

Only state what the tools returned. If a tool fails or has no data source, say that part is unverified rather than filling it in from general knowledge. Road refs, distances, times and forecasts in the answer must come from tool results.

Finish with the itinerary in plain text for a terminal:
- one line naming the ride and why it was picked
- departure time, total distance, riding time, and a realistic total with breaks
- motorway use (should be none) and the share of distance posted at 30 km/h or less and at 31-50 km/h, against the rider's targets
- numbered legs: road refs, towns passed, leg distance, what makes the leg worth riding
- weather along the route by time of day
- traffic, or a note that it was not checked
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
      : "- Motorways (autoroutes): allowed for getting to and from the riding area, not for the ride itself.",
    `- Zones limited to 30 km/h or less: as little as possible, target at most ${p.max30Pct}% of the distance.`,
    `- Zones limited to 31-50 km/h: acceptable where needed, target at most ${p.max50Pct}% of the distance.`,
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
  return `This session evolves saved ride #${ride.id} "${ride.name}". Start from its waypoints rather than searching for a new area: route it again to get a route ID for this session, check the weather for the new day, then apply the request above, changing only what it asks for. Overlap with this ride is expected.\n${JSON.stringify(data)}`;
}

export interface RideSession {
  context: RideContext;
  /** Send the next message (a refinement of the previous itinerary) and print the answer. */
  send(text: string): Promise<void>;
  /** The latest itinerary that can be saved, if the model has produced one. */
  current(): CurrentRide | undefined;
}

/**
 * Plan the ride, printing the model's text as it arrives. The returned session
 * keeps the whole conversation, tool results included, so follow-ups such as
 * "shorter" or "skip Die" build on what was already looked up.
 */
export async function startRide(request: RideRequest): Promise<RideSession> {
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
  const tools = createTools(context);
  let history: Anthropic.Beta.BetaMessageParam[] = [];
  let current: CurrentRide | undefined;

  async function send(text: string): Promise<void> {
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      // If a safety classifier declines the request, the API re-runs it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Cache the growing conversation so each round and each follow-up re-reads it cheaply.
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      tools,
      max_iterations: MAX_ITERATIONS,
      // The runner appends to this array; history is only replaced once the turn succeeds.
      messages: [...history, { role: "user", content: text }],
    });

    let last: Anthropic.Beta.BetaMessage | undefined;
    let inputTokens = 0;
    let cachedTokens = 0;
    let outputTokens = 0;
    for await (const message of runner) {
      last = message;
      inputTokens += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0);
      cachedTokens += message.usage.cache_read_input_tokens ?? 0;
      outputTokens += message.usage.output_tokens;
      for (const block of message.content) {
        if (block.type === "text" && block.text.trim()) console.log(`\n${block.text.trim()}`);
      }
    }

    process.stderr.write(
      `\x1b[2m\n[${MODEL}, ${inputTokens} tokens in, ${cachedTokens} read from cache, ${outputTokens} out]\x1b[0m\n`,
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

  const repeatRule = context.allowRepeat ? "\nRepeating saved rides is allowed this time." : "";
  const base = request.baseRide ? `\n\n${describeBaseRide(request.baseRide)}` : "";
  await send(
    `${request.prompt}\n\nStart and end point: ${request.home} (${start.label}, ${start.lat},${start.lon})\nRoad preferences:\n${describePreferences(preferences)}${repeatRule}\nToday is ${WEEKDAYS[now.getDay()]} ${today}.${base}`,
  );
  return { context, send, current: () => current };
}
