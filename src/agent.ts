import Anthropic from "@anthropic-ai/sdk";
import { EFFORT, isLegacyThinking, MODEL, requestSettings } from "./model.ts";
import { DEFAULT_PREFERENCES, type RidePreferences } from "./preferences.ts";
import { RideAnswer } from "./schema.ts";
import type { RegisteredRoute, RideContext, TraceEvent } from "./session.ts";
import type { SavedRide, Store } from "./store.ts";
import { setGeoAnchor } from "./tools/geo.ts";
import { createTools } from "./tools/index.ts";
import { countUsage, describeResponse, emptyUsage, type RunUsage } from "./usage.ts";

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

const MAX_ITERATIONS = 40;

/** What the planner is and how it works; shared by the API planner and the MCP prompt. */
export const SYSTEM_CORE = `You plan one-day motorcycle rides for a rider who wants an itinerary they can follow tomorrow morning.

You work from real data, gathered with your tools: road geometry from OpenStreetMap, routed distances and times, hourly forecasts, and traffic when a source is configured. You decide where to look. For a new leisure ride, start by sending scouts: pick two to four riding areas within reach of the start point (a town or village in the middle of promising country, not a city), and call scoutAreas once with all of them. Each scout searches its area, assembles a loop within the constraints, routes it and checks the weather, then reports a candidate with a routeId you can use directly. Compare the candidates, take the best, confirm anything a scout left unverified (weather at the hours in question, the return leg), improve it if a slow stretch can be bypassed, and present it. If no scout found a satisfying loop, send scouts to other areas or build a loop yourself with searchRoads and calculateTrip. Do not send scouts for an edit of an existing itinerary, a question, or a practical trip. Independent lookups can be issued together in one turn.

What makes a good ride here is open road: time spent outside towns and villages, on roads that bend, and never on motorways. Every routed trip reports openRoadPct, the share of its distance outside built-up areas and off motorways, next to the share in zones limited to 30 km/h or less and to 31-50 km/h. Cobbles, setts and unpaved roads are reported per routed trip (speedLimits.surface); avoid them when another road exists, and name the ones that remain. Slow zones cannot be avoided completely, since every ride leaves a town and crosses villages; the job is to keep them as small as the terrain allows. The rider's percentages are targets to aim for, not pass/fail limits. Among loops that satisfy the hard constraints, prefer the one with the most open road, and when a loop is over a target, look at where its longest 30 and 50 stretches are and move or drop waypoints so the route skirts town centres instead of crossing them, then route it again. Do this before settling, and do not give up a clearly better riding area just to shave a point of slow zone. Limits come from OpenStreetMap; untagged stretches are classed by whether they lie in a built-up area.

Riding time is estimated per road segment from its speed limit and how much it bends, without stops or traffic. Judge time constraints against that estimate. The router's own time is also returned as an upper bound; it is pessimistic and is not the figure to plan with.

The rider's own yardstick is time at 70 km/h or more. Every routed trip reports timeOnRoads70PlusPct (share of riding time on roads limited to 70 or above) and timeAbove70EstimatedPct (time at an estimated 70 or more, which needs limits of 80 and up). Report both, and prefer loops where they are high.

Daylight sets the frame of the day: get the sunrise and sunset for the ride day (getDaylight, also returned with every forecast) and plan departure and return inside them, with a margin before sunset. Say when the last usable light is.

Plan on road data first. Once a loop is chosen, finish it: run the traffic check for the planned departure and report the delay next to the road-data estimate; list the fixed speed cameras on the loop (getSpeedCameras) as places to watch the speed; check crosswind and low sun on the loop for the date and departure (checkConditions) and mention any stretch, moving the departure if a long glare stretch falls on the way home; and plan the stops with planStops, which applies the rider's bike profile (tank range, reserve, pause interval, lunch) and returns the chosen fuel, pause and lunch stops with arrival times, the return time with breaks, and navigation links that include the stops. Name those stops in the itinerary and use those links, not the plain map link, since they also keep Google Maps on the chosen roads. Reconsider the departure time or the loop only if traffic or daylight demands it.

Not every request is a leisure ride. When the rider asks for a practical trip, such as getting to work or reaching a place by a given time, plan it as one: point to point unless they say otherwise, the quickest sensible route, on motorways when the rider permits them (route it with motorways allowed, and compare with the motorway-free route if the difference is worth showing). Skip the search for winding roads, and do not optimise open road or slow zones; report them briefly. Check the weather for the travel hours and the traffic for the departure time, since a commute lives or dies by traffic, and give the arrival time. Saved-ride overlap does not matter for such a trip: repeating a commute is the point. The itinerary is shorter: route, distance, time with and without traffic, weather, link, and the reference line.

The rider keeps a library of saved rides, and each ride and leg may carry a rating from 1 to 5 given after riding it. Look at the library once at the start. Legs rated 4 or 5 are proven: reuse them as building blocks when they fit, since their coordinates go straight into a route. Roads from rides or legs rated 0 or 1 are to be avoided: every routed trip reports ratedRoads, and a loop with 10% or more on such roads is not valid unless nothing else meets the hard limits; when you keep one anyway, say which rated roads it uses and why. Rated 2 or 3: neutral. The rider saves rides so that the next one is different: every routed trip comes back with a verdict comparing it with the saved rides, and a trip marked DUPLICATE is not a valid proposal and cannot be saved; choose other roads or another area. A request that matches a saved ride is not a reason to rebuild it: tell the rider that ride exists and offer to open it instead. A trip marked similar is fine, and worth a mention. Saved data replaces road discovery only: weather is always checked fresh for the day in question.

The rider's constraints are hard limits: a ride described as dry must be dry along the whole loop for the riding hours, and a distance cap applies to the routed total including getting there and back. If nothing satisfies every constraint, say so and offer the closest option, naming which constraint it breaks and by how much.

Only state what the tools returned. If a tool fails or has no data source, say that part is unverified rather than filling it in from general knowledge. Road refs, distances, times and forecasts in the answer must come from tool results.

Lay the itinerary out for a terminal, short and scannable, no markdown headings:
- one line: ride name, and why it was picked
- one line: departure, total distance, estimated riding time, average speed, realistic total with breaks
- one line: open-road share, time at 70 km/h or more (both readings), motorway use (should be none), 30 and 50 zone shares against the rider's targets
- one line: daylight for the day (sunrise, sunset, last light) and whether the plan fits inside it
- legs, one per line, numbered: from -> to (town names, never bare coordinates: name the nearest village or the road), main roads, distance, riding time, average speed, and a few words on what makes the leg worth riding
- weather along the route by time of day, one line per point
- traffic for the planned departure, or "not checked"
- speed cameras on the loop: km mark, road, limit; or "none mapped"
- crosswind and low-sun stretches with km and time, and any cobbled or unpaved stretch by road; or "none"
- stops from the stop plan: time, km mark, kind, name; and the return time with breaks
- the navigation link(s) from planStops (or navigationLinks from calculateTrip when no stops were planned); say "part 1, part 2" when there are several
- one alternative in a sentence, if evaluated
Keep explanations to the facts the rider needs; put caveats (unverified data, missed targets) in one line each, not paragraphs.

The rider may then ask for changes. Treat a follow-up as an edit of the current itinerary: keep what they did not ask to change, reuse lookups you already have, and call tools again for anything the change affects (a new loop must be routed again, new places need their forecast). Answer with the full updated itinerary in the same format, opening with one line on what changed. If the follow-up is a question rather than a change, just answer it.`;

/** API planner only: the final answer is validated against a schema. */
const JSON_ANSWER = `Your final answer is a JSON object with two fields. "message" holds the full text for the rider, written for a terminal. "ride" names the routed trip the message presents: the routeId from the routing call for the exact loop the itinerary describes, the ride date and departure, and a short name a rider would recognise the ride by; it is null when the message is an answer without a new itinerary. The legs, distance and link in the itinerary must be those of that routed trip.`;

export const SYSTEM = `${SYSTEM_CORE}

${JSON_ANSWER}`;

/** The lines every planner, built-in or MCP, gets about the rider's situation. */
export function describeSituation(
  home: string,
  start: { label: string; lat: number; lon: number } | undefined,
  preferences: RidePreferences,
  now = new Date(),
): string {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const where = start?.label ? `${home} (${start.label}, ${start.lat},${start.lon})` : "NOT SET";
  return `Start and end point: ${where}\nRoad preferences:\n${describePreferences(preferences)}\nToday is ${WEEKDAYS[now.getDay()]} ${today}.`;
}

export function describePreferences(p: RidePreferences): string {
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
  /** Model, effort, tokens and time consumed by this session so far, scouts included. */
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
  const usage = emptyUsage(MODEL, isLegacyThinking(MODEL) ? "n/a" : EFFORT);
  // The run row exists from the start so that every step can be traced against it.
  const runId = request.store.startRun({
    home: request.home,
    request: "",
    usage,
    costUsd: 0,
    result: null,
    rideId: null,
    error: null,
  });
  const context: RideContext = {
    store: request.store,
    // Copied, so a mid-session switch does not leak into the caller's object.
    preferences: { ...preferences },
    home: start,
    allowRepeat: request.allowRepeat ?? false,
    lineage: new Set(request.baseRide ? [request.baseRide.id] : []),
    routes: new Map(),
    runId,
    usage,
    trace: (event: TraceEvent) => request.store.addTrace(runId, event),
    stopPlans: new Map(),
  };
  const tools = createTools(context, { scouts: true });
  let history: Anthropic.Beta.BetaMessageParam[] = [];
  let current: CurrentRide | undefined;

  async function send(text: string): Promise<void> {
    context.trace({ scope: "main", kind: "user", name: "message", payload: text });
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      ...requestSettings(MODEL, EFFORT, RideAnswer),
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
        countUsage(usage, message);
        context.trace({
          scope: "main",
          kind: "model",
          name: message.model,
          ms: Date.now() - started,
          payload: describeResponse(message),
        });
        // Text before the final answer is rare (progress goes to thinking); show it as is.
        if (message.stop_reason !== "end_turn") {
          for (const block of message.content) {
            if (block.type === "text" && block.text.trim()) console.log(`\n${block.text.trim()}`);
          }
        }
      }
    } catch (error) {
      context.trace({
        scope: "main",
        kind: "error",
        name: "turn",
        payload: error instanceof Error ? error.message : String(error),
      });
      throw error;
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

        const raw = last.content
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("\n")
          .trim();
        const answer = parseAnswer(raw);
        console.log(`\n${answer.message.trim()}`);
        context.trace({ scope: "main", kind: "answer", name: answer.ride ? "itinerary" : "answer", payload: answer });
        // An answer naming a routed trip is a new itinerary; a plain answer leaves the current one in place.
        const route = answer.ride && context.routes.get(answer.ride.routeId);
        if (answer.ride && !route) {
          console.error(
            `\nWarning: the answer refers to route ${answer.ride.routeId}, which was never routed this session; it cannot be saved.`,
          );
        }
        if (answer.ride && route) {
          current = {
            route,
            rideDate: answer.ride.rideDate,
            departure: answer.ride.departure,
            title: answer.ride.name,
            itinerary: answer.message.trim(),
          };
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
    await send(`${text}\n\n${describeSituation(request.home, start, context.preferences, now)}${repeatRule}${base}`);
    opened = true;
  }
  return { context, send: sendWithContext, current: () => current, usage: () => ({ ...usage }) };
}

/**
 * The API validates the answer against the schema, so this normally just
 * parses. Should a model ever answer in prose anyway, show the prose rather
 * than fail the turn.
 */
function parseAnswer(raw: string): RideAnswer {
  try {
    return RideAnswer.parse(JSON.parse(raw));
  } catch {
    return { message: raw, ride: null };
  }
}
