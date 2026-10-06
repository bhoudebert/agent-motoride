// Run one eval case through the API planner, live (recording) or from a cassette.
import { openRide } from "../src/agent.ts";
import { saveCurrentRide } from "../src/library.ts";
import { EFFORT, MODEL, SCOUT_EFFORT, SCOUT_MODEL } from "../src/model.ts";
import { DEFAULT_PREFERENCES } from "../src/preferences.ts";
import { duplicateOf, ratedOverlap, registerRoute } from "../src/session.ts";
import { Store } from "../src/store.ts";
import { resetGeoState } from "../src/tools/geo.ts";
import { computeTrip } from "../src/tools/trip.ts";
import { estimateCostUsd, type RunUsage } from "../src/usage.ts";
import { type Cassette, type Exchange, record, replay } from "./cassette.ts";
import { type EvalCase, INJECTION } from "./cases.ts";
import { grade, type Outcome } from "./graders.ts";

export interface CaseRun {
  outcome: Outcome;
  scores: Record<string, boolean>;
  usage: RunUsage;
  costUsd: number;
  /** Recording: the new cassette. Replay: the cassette, plus any tool answers fetched with updateTools. */
  cassette: Cassette;
  misses: string[];
  drift: string[];
  added: Exchange[];
}

/** Plant the injection text in every name the map services return: roads, places, shops, cameras. */
export function plantInjection(url: URL, body: string): string {
  if (!/overpass|photon|nominatim|valhalla/.test(url.host)) return body;
  try {
    const data = JSON.parse(body) as {
      elements?: Array<{ tags?: Record<string, string> }>;
      features?: Array<{ properties?: Record<string, unknown> }>;
      edges?: Array<{ names?: string[] }>;
    };
    // Road names on routed edges come from OpenStreetMap too.
    for (const edge of data.edges ?? []) if (edge.names?.[0]) edge.names[0] = `${edge.names[0]}. ${INJECTION}`;
    for (const element of data.elements ?? [])
      if (element.tags?.name) element.tags.name = `${element.tags.name}. ${INJECTION}`;
    for (const feature of data.features ?? []) {
      if (feature.properties?.name) feature.properties.name = `${String(feature.properties.name)}. ${INJECTION}`;
    }
    return JSON.stringify(data);
  } catch {
    return body;
  }
}

/** Keep the console for the harness: the planner prints its answers and tool calls as it goes. */
function silence(): () => void {
  const log = console.log;
  const write = process.stderr.write.bind(process.stderr);
  console.log = () => undefined;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  return () => {
    console.log = log;
    process.stderr.write = write;
  };
}

export async function runCase(
  c: EvalCase,
  options: { cassette?: Cassette; updateTools?: boolean; verbose?: boolean } = {},
): Promise<CaseRun> {
  const replaying = options.cassette !== undefined;
  // Optional services shape tool results: replay with the ones the recording had.
  // Credentials are redacted from recorded requests, so a placeholder key matches.
  const trafficKey = process.env.TOMTOM_API_KEY;
  if (replaying) {
    if (options.cassette!.traffic) process.env.TOMTOM_API_KEY = "replay-redacted";
    else delete process.env.TOMTOM_API_KEY;
  }
  const now = replaying ? new Date(options.cassette!.now) : new Date();
  resetGeoState();
  const store = new Store(":memory:");
  const tape = replaying
    ? replay(options.cassette!, {
        updateTools: options.updateTools,
        transform: c.inject ? plantInjection : undefined,
      })
    : record(c.inject ? plantInjection : undefined);
  const unmute = options.verbose ? () => undefined : silence();
  const preferences = { ...DEFAULT_PREFERENCES, ...c.preferences };
  try {
    for (const seed of c.seed ?? []) {
      const setup = await openRide({ home: c.home, store, preferences, now });
      const trip = await computeTrip({ waypoints: seed.waypoints, roundTrip: true, avoidMotorways: true });
      const route = registerRoute(setup.context, trip);
      const id = saveCurrentRide(
        setup.context,
        { route, rideDate: null, departure: null, title: seed.name, itinerary: "seeded for an eval" },
        { request: "seed", parentId: null, home: c.home, force: true },
      );
      if (seed.rating !== undefined) store.rateRide(id, seed.rating, null);
    }

    const session = await openRide({ home: c.home, store, preferences, now });
    let error: string | null = null;
    try {
      await session.send(c.request);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const trace = store.listTrace(session.context.runId);
    const answerEvent = trace.findLast((e) => e.scope === "main" && e.kind === "answer");
    const current = session.current();
    const route = current?.route;
    const outcome: Outcome = {
      answer: (answerEvent?.payload as Outcome["answer"]) ?? null,
      error,
      trip: route?.trip.result ?? null,
      preferencesBefore: preferences,
      preferencesAfter: { ...session.context.preferences },
      tools: trace
        .filter((e) => e.kind === "tool")
        .map((e) => {
          const payload = e.payload as { input: unknown; output?: unknown };
          return { scope: e.scope, name: e.name, input: payload.input, output: payload.output };
        }),
      duplicate: route ? duplicateOf(session.context, route.cells) !== undefined : false,
      ratedAvoidPct: route ? ratedOverlap(session.context, route.cells).avoidPct : 0,
    };
    const scores = grade(c, outcome);
    const usage = session.usage();
    const costUsd = estimateCostUsd(usage) ?? 0;
    // A refresh keeps what this replay used plus what it fetched; anything else is a leftover.
    const exchanges = !replaying
      ? (tape as ReturnType<typeof record>).exchanges
      : "used" in tape && options.updateTools
        ? [...options.cassette!.exchanges.filter((e) => tape.used.has(e.key)), ...tape.added]
        : options.cassette!.exchanges;
    const cassette: Cassette = replaying
      ? { ...options.cassette!, exchanges }
      : {
          caseId: c.id,
          recordedAt: new Date().toISOString(),
          now: now.toISOString(),
          model: MODEL,
          effort: EFFORT,
          scoutModel: SCOUT_MODEL,
          scoutEffort: SCOUT_EFFORT,
          traffic: Boolean(process.env.TOMTOM_API_KEY),
          costUsd: Number(costUsd.toFixed(4)),
          scores,
          exchanges,
        };
    return {
      outcome,
      scores,
      usage,
      costUsd,
      cassette,
      misses: "misses" in tape ? tape.misses : [],
      drift: "drift" in tape ? tape.drift : [],
      added: "added" in tape ? tape.added : [],
    };
  } finally {
    if (trafficKey === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = trafficKey;
    unmute();
    tape.restore();
    store.close();
  }
}

/** Graders that passed when the cassette was recorded and fail now. */
export function regressions(recorded: Record<string, boolean>, now: Record<string, boolean>): string[] {
  return Object.entries(recorded)
    .filter(([name, passed]) => passed && now[name] !== true)
    .map(([name]) => name);
}
