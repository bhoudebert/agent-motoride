import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { openRide, type RideSession } from "./agent.ts";
import { addRideNote, pendingNotesSummary } from "./feedback.ts";
import { exportSavedRide, savedRideGpx, writeGpx } from "./gpx.ts";
import {
  DuplicateRideError,
  enrichRide,
  formatRideDetail,
  formatRideList,
  parseRating,
  rideNavigation,
  saveCurrentRide,
} from "./library.ts";
import { pinnedMapsLinks } from "./maps.ts";
import { writeRideMarkdown } from "./markdown.ts";
import { DEFAULT_PREFERENCES, preferencesFromEnv } from "./preferences.ts";
import { describeProfile, parseProfileArgs } from "./profile.ts";
import { printQr, type Shared, startShareServer } from "./share.ts";
import { type SavedRide, Store } from "./store.ts";
import { usePersistentGeoCache } from "./tools/geo.ts";
import { formatTrace } from "./trace.ts";
import { estimateCostUsd, formatUsage, isKnownModel } from "./usage.ts";

const USAGE = `Usage: npm run ride                              Start menu: plan a new ride or open a saved one
       npm run ride -- [options] "<what you want>"  Plan a ride directly

  npm run ride -- --from "Grenoble" "Roadtrip moto this Saturday, no rain, <250km, winding roads, give me an itinerary"
  npm run ride -- --ride 3 "same ride next Sunday, 50 km longer, lunch in Die"

Options:
  --from <place>        Start and end point. Defaults to RIDE_HOME, or the saved ride's start with --ride.
  --show <id|name>      Display a saved ride and exit. No planning, no API call.
  --ride <id|name>      Work on a saved ride. With a request: apply it. Without: open the prompt on the ride.
  --allow-repeat        Accept rides that repeat saved ones. Default: near-duplicates are rejected.
  --save-as <name>      Save the first itinerary under this name (useful with --once).
  --allow-motorways     Permit motorways (autoroutes), e.g. for a commute. Default: never used.
                        Also switchable during a session with /motorways on|off.
  --max-30-pct <n>      Target max % of distance in zones of 30 km/h or less. Default ${DEFAULT_PREFERENCES.max30Pct}.
  --max-50-pct <n>      Target max % of distance in 31-50 km/h zones. Default ${DEFAULT_PREFERENCES.max50Pct}.
  --once                Print the itinerary and exit, without the refine prompt.

At the "refine>" prompt, type a change in plain words, or a command:
${refineHelp()}

Saved rides are managed with: npm run rides -- list | show | rate | rate-leg | note | review | delete
Env equivalents: RIDE_ALLOW_MOTORWAYS=1, RIDE_MAX_30_PCT, RIDE_MAX_50_PCT.
Needs ANTHROPIC_API_KEY (see .env.example).`;

function refineHelp(): string {
  return `  /save [name]          Save the current itinerary (new version if already saved); refused when it duplicates a saved ride, --force to override
  /list                 Saved rides
  /show [id|name]       Details of a saved ride (no argument: the one loaded or saved here)
  /gpx [file.gpx]       Export the current itinerary (or the loaded ride) as a GPX file
  /md [file.md]         Export the saved or loaded ride as a Markdown document (save first)
  /qr                   QR code of the Google Maps link, to scan with the phone
  /share                Page for the phone on the local Wi-Fi (map link, itinerary, GPX download) with its QR code
  /rate <1-5> [note]    Rate the ride saved or loaded in this session
  /note <text> [--rating 0-5] [--back N]  During the ride: note about the last N minutes (default 10), reviewed after the ride
  /motorways on|off     Permit or forbid motorways from now on (default off)
  /settings             Show current settings: motorways, slow-zone targets, traffic
  /bike [range=250 ...] Show or set the bike profile (range, reserve, pause, stint, lunch) used for stops
  /usage                Model, tokens, time and estimated cost of this session so far
  /trace                Replay this session's steps so far (tool calls, scouts, answers)
  /back                 Leave this ride and return to the start menu (also Ctrl-D)
  /quit                 Quit the program (also exit, Ctrl-C)
  /help                 This list`;
}

const { values, positionals } = parseArgs({
  options: {
    from: { type: "string" },
    ride: { type: "string" },
    show: { type: "string" },
    "allow-repeat": { type: "boolean" },
    "save-as": { type: "string" },
    "allow-motorways": { type: "boolean" },
    "max-30-pct": { type: "string" },
    "max-50-pct": { type: "string" },
    once: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const hasRequest = positionals.length > 0 || Boolean(values.ride) || Boolean(values.show);

// With nothing to do and nobody to ask, explain how to call the program.
if (values.help || (!hasRequest && !interactive)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const motorwayDefault = () => Boolean(values["allow-motorways"] ?? !preferencesFromEnv().avoidMotorways);

/** One line stating the settings a session runs with, so nothing is implicit. */
function describeSettings(
  home: string,
  preferences: { avoidMotorways: boolean; max30Pct: number; max50Pct: number },
): string {
  return [
    `Start: ${home}`,
    `motorways: ${preferences.avoidMotorways ? "FORBIDDEN" : "PERMITTED"}`,
    `30 zones: aim <= ${preferences.max30Pct}%`,
    `50 zones: aim <= ${preferences.max50Pct}%`,
    `traffic check: ${process.env.TOMTOM_API_KEY ? "on" : "off (no TOMTOM_API_KEY)"}`,
    `model: ${process.env.RIDE_MODEL || "claude-opus-5-5"}, effort ${process.env.RIDE_EFFORT || "high"}`,
  ].join("  |  ");
}

function percent(flag: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    console.error(`${flag} must be a number between 0 and 100, got "${raw}".`);
    process.exit(1);
  }
  return value;
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Claude API rejected the credentials. Check ANTHROPIC_API_KEY in .env.";
  }
  if (error instanceof Anthropic.RateLimitError) return "Claude API rate limit hit. Retry in a minute.";
  if (error instanceof Anthropic.APIConnectionError) return `Could not reach the Claude API: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

type Outcome = "back" | "quit";
const BACK = Symbol("back");
const QUIT = Symbol("quit");

/**
 * Ask one line at the terminal. Ctrl-D answers BACK (one step back, never a
 * kill), Ctrl-C answers QUIT. Either closes the readline interface, so a fresh
 * one is created for the next question.
 */
const prompter = (() => {
  let readline: ReturnType<typeof createInterface> | undefined;
  let closed: Promise<null> = Promise.resolve(null);
  let interrupted = false;
  return {
    async ask(question: string): Promise<string | typeof BACK | typeof QUIT> {
      if (!readline) {
        interrupted = false;
        const created = createInterface({ input: process.stdin, output: process.stdout });
        created.on("SIGINT", () => {
          interrupted = true;
          created.close();
        });
        closed = new Promise((resolve) => {
          created.once("close", () => {
            if (readline === created) readline = undefined;
            resolve(null);
          });
        });
        readline = created;
      }
      // A closed interface does not always settle a pending question, so the
      // close event is raced against it.
      const answer = await Promise.race([readline.question(question).catch(() => null), closed]);
      if (answer !== null) return answer.trim();
      console.log(); // the cursor is left on the prompt line
      return interrupted ? QUIT : BACK;
    },
    close() {
      readline?.close();
      readline = undefined;
    },
  };
})();

let shareServer: import("node:http").Server | undefined;
let shareUrl: string | undefined;
// Keeps the last ride served, so the share page can answer without routing again.
let lastShared: Shared | undefined;

const store = new Store();
// Place names for coordinates never change: keep them across sessions.
usePersistentGeoCache({
  get: (key) => store.cacheGet<string>(key),
  set: (key, value) => store.cacheSet(key, "reverseGeocode", value, 365 * 24 * 3_600_000),
});
let exitCode = 0;

try {
  store.cachePurgeExpired();

  if (values.show) {
    const ride = store.findRide(values.show);
    if (!ride) throw new Error(`No saved ride matches "${values.show}". Run: npm run rides -- list`);
    console.log(formatRideDetail(ride));
  } else if (hasRequest) {
    let baseRide: SavedRide | undefined;
    if (values.ride) {
      baseRide = store.findRide(values.ride);
      if (!baseRide) throw new Error(`No saved ride matches "${values.ride}". Run: npm run rides -- list`);
    }
    const request = positionals.join(" ").trim();
    let outcome: Outcome;
    if (request) outcome = await plan(request, baseRide, values.from);
    // A saved ride with no request: open the prompt on it when someone is there
    // to type, otherwise replan it for the coming weekend.
    else if (interactive && !values.once) outcome = await plan(null, baseRide, values.from);
    else {
      outcome = await plan(
        "Plan this saved ride again for the coming Saturday or Sunday, whichever has the better weather, and update the itinerary.",
        baseRide,
        values.from,
      );
    }
    if (outcome === "back") await menuLoop();
  } else {
    await menuLoop();
  }
} catch (error) {
  console.error(describeError(error));
  exitCode = 1;
} finally {
  prompter.close();
  shareServer?.close();
  store.close();
}
process.exit(exitCode);

/**
 * Plan a new ride, or work on `baseRide`, then offer the refine prompt. With a
 * null request the saved ride is only loaded: the prompt opens at once and the
 * model is not called until the rider types something.
 */
async function plan(
  request: string | null,
  baseRide: SavedRide | undefined,
  from: string | undefined,
  allowMotorways?: boolean,
): Promise<Outcome> {
  const home = from ?? baseRide?.home ?? process.env.RIDE_HOME;
  if (!home) throw new Error('No start point: pass --from "<place>" or set RIDE_HOME.');
  if (request === null && !(baseRide && interactive)) {
    throw new Error("Editing a saved ride needs a terminal and a ride to open.");
  }

  const fromEnv = preferencesFromEnv();
  const preferences = {
    // Explicit choice first (menu answer or flag), then a saved ride's own setting, then the env default.
    avoidMotorways: !(
      allowMotorways ??
      values["allow-motorways"] ??
      ((baseRide && !baseRide.preferences.avoidMotorways) || !fromEnv.avoidMotorways)
    ),
    max30Pct: percent("--max-30-pct", values["max-30-pct"], fromEnv.max30Pct),
    max50Pct: percent("--max-50-pct", values["max-50-pct"], fromEnv.max50Pct),
  };

  if (baseRide) console.error(`Working on saved ride #${baseRide.id} "${baseRide.name}".`);
  console.error(describeSettings(home, preferences));
  console.error(`Bike: ${describeProfile(store.getProfile())}`);
  const model = process.env.RIDE_MODEL || "claude-opus-5-5";
  if (!isKnownModel(model)) {
    console.error(
      `Warning: RIDE_MODEL "${model}" is not a model this app knows. Check the spelling: claude-opus-5-5, claude-sonnet-5-5, claude-haiku-4-5.`,
    );
  }
  const session = await openRide({
    home,
    store,
    preferences,
    allowRepeat: values["allow-repeat"] ?? false,
    baseRide,
  });
  // The saved ride this session's work descends from: the loaded one, then each save.
  let savedId: number | null = baseRide?.id ?? null;
  let savedItinerary: string | null = null;
  const requests: string[] = [];

  // Every turn updates the runs table, saved ride or not, failed or not,
  // so models and effort levels can be compared afterwards.
  let runRideId: number | null = null;
  const logRun = (error: string | null) => {
    const trip = session.current()?.route.trip.result;
    const limits = trip?.speedLimits as
      | {
          openRoadPct?: number;
          limit31to50?: { pct: number };
          limit30OrLess?: { pct: number };
          motorwayKm?: number;
          timeOnRoads70PlusPct?: number;
        }
      | undefined;
    const usage = session.usage();
    const record = {
      home,
      request: requests.join(" / "),
      usage,
      costUsd: estimateCostUsd(usage),
      result: trip
        ? {
            distanceKm: trip.totalDistanceKm,
            ridingMinutes: trip.totalRidingMinutes,
            openRoadPct: limits?.openRoadPct ?? null,
            pct50: limits?.limit31to50?.pct ?? null,
            pct30: limits?.limit30OrLess?.pct ?? null,
            motorwayKm: limits?.motorwayKm ?? null,
            time70Pct: limits?.timeOnRoads70PlusPct ?? null,
          }
        : null,
      rideId: runRideId,
      error,
    };
    store.updateRun(session.context.runId, record);
  };
  const send = session.send;
  session.send = async (text: string) => {
    requests.push(text.replace(/^\[Setting changed[^\]]*\]\n/, ""));
    console.error(
      `\x1b[2m(run #${session.context.runId}; replay later with: npm run rides -- trace ${session.context.runId})\x1b[0m`,
    );
    try {
      await send(text);
      logRun(null);
    } catch (error) {
      logRun(describeError(error));
      throw error;
    }
  };

  if (request !== null) await session.send(request);
  const hasUnsaved = () => {
    const ride = session.current();
    return ride !== undefined && ride.itinerary !== savedItinerary;
  };

  const save = (nameArg?: string) => {
    const force = /(^|\s)--force(\s|$)/.test(nameArg ?? "");
    const name = (nameArg ?? "").replace(/(^|\s)--force(\s|$)/, " ").trim();
    const ride = session.current();
    if (!ride) {
      console.log(
        requests.length === 0 && savedId
          ? `Ride #${savedId} is already saved and has not been changed. Ask for a change first; /save then stores a new version.`
          : "Nothing to save yet: the last answer did not contain a routed itinerary. Ask for one, then /save.",
      );
      return;
    }
    if (ride.itinerary === savedItinerary) {
      console.log(`Already saved as #${savedId}. Change the ride first to save a new version.`);
      return;
    }
    let id: number;
    try {
      id = saveCurrentRide(session.context, ride, {
        name,
        request: requests.join(" / "),
        parentId: savedId,
        home,
        usage: session.usage(),
        force,
      });
    } catch (error) {
      if (error instanceof DuplicateRideError) {
        console.log(`${error.message}\nTo save anyway: /save --force${name ? ` ${name}` : ""}`);
        return;
      }
      throw error;
    }
    runRideId = id;
    logRun(null);
    const version = savedId ? ` (new version of #${savedId})` : "";
    savedId = id;
    savedItinerary = ride.itinerary;
    console.log(
      `Saved as #${id} "${store.findRide(String(id))!.name}"${version}, ${ride.route.trip.result.totalDistanceKm} km.`,
    );
    // Daylight, cameras and stops for the ride view; cached lookups, so quick after a plan.
    void enrichRide(store, store.findRide(String(id))!).catch(() => undefined);
  };

  if (values["save-as"]) save(values["save-as"]);

  // Refine loop: only when a person is at the terminal.
  if (!values.once && interactive) {
    return refineLoop(
      session,
      requests,
      save,
      () => savedId,
      hasUnsaved,
      () => logRun(null),
      request === null,
    );
  }
  return "quit";
}

/** Start menu, then the chosen ride, and back to the menu until the rider quits. */
async function menuLoop(): Promise<void> {
  while (true) {
    const choice = await startMenu();
    if (!choice) return;
    try {
      const outcome = await plan(choice.prompt, choice.baseRide, choice.home, choice.allowMotorways);
      if (outcome === "quit") return;
    } catch (error) {
      // A failed plan (network, API, unknown place) should not close the program.
      console.error(`${describeError(error)}\nBack to the menu.`);
    }
  }
}

/**
 * Opening menu: plan a new ride, or browse saved rides and edit or rate one.
 * Returns what to plan, or undefined to quit. Ctrl-D steps back one level and
 * only quits from the top level.
 */
async function startMenu(): Promise<
  { prompt: string | null; baseRide?: SavedRide; home?: string; allowMotorways?: boolean } | undefined
> {
  const { ask } = prompter;
  // A lone menu key typed at a free-text question means "cancel", not a ride request.
  const isCancel = (answer: string) => ["b", "back", "q", "quit", "exit"].includes(answer.toLowerCase());

  while (true) {
    const rides = store.listRides();
    const pending = pendingNotesSummary(store);
    console.log(
      `\nagentMotoride   (motorways ${motorwayDefault() ? "permitted" : "forbidden"} by default)\n  1. Plan a new ride\n  2. Open a saved ride (${rides.length} saved)\n  q. Quit`,
    );
    if (pending) console.log(`\n${pending}: npm run rides -- review [track.gpx]`);
    const choice = await ask("\n> ");
    if (typeof choice === "symbol" || ["q", "quit", "exit"].includes(choice.toLowerCase())) return undefined;

    if (choice === "1") {
      const prompt = await ask(
        '\nWhat ride do you want? (e.g. "this Saturday, no rain, under 250 km, winding roads"; b to go back)\n> ',
      );
      if (prompt === QUIT) return undefined;
      if (prompt === BACK || !prompt || isCancel(prompt)) continue;
      const defaultHome = values.from ?? process.env.RIDE_HOME;
      const homeAnswer = await ask(`Start point${defaultHome ? ` [${defaultHome}]` : ""}: `);
      if (homeAnswer === QUIT) return undefined;
      if (homeAnswer === BACK) continue;
      const home = homeAnswer || defaultHome;
      if (!home) {
        console.log("A start point is needed.");
        continue;
      }
      // The default answer follows the flag or RIDE_ALLOW_MOTORWAYS.
      const allowed = motorwayDefault();
      const motorways = await ask(
        `Allow motorways, e.g. for a commute? Currently ${allowed ? "permitted" : "forbidden"}. [${allowed ? "Y/n" : "y/N"}]: `,
      );
      if (motorways === QUIT) return undefined;
      if (motorways === BACK) continue;
      const allowMotorways = motorways === "" ? allowed : ["y", "yes"].includes(motorways.toLowerCase());
      return { prompt, home, allowMotorways };
    }

    if (choice === "2") {
      if (rides.length === 0) {
        console.log("\nNo saved rides yet. Plan one, then /save it.");
        continue;
      }
      console.log(`\n${formatRideList(rides)}`);
      const pick = await ask("\nRide id or name (Enter to go back): ");
      if (pick === QUIT) return undefined;
      if (pick === BACK || !pick) continue;
      let ride: SavedRide | undefined;
      try {
        ride = store.findRide(pick);
      } catch (error) {
        console.log(describeError(error));
        continue;
      }
      if (!ride) {
        console.log(`No saved ride matches "${pick}".`);
        continue;
      }
      console.log(`\n${formatRideDetail(ride)}`);

      while (true) {
        const action = await ask(
          "\n[e] edit: open the prompt on this ride  [g] export GPX  [r] rate it  [b] back  [q] quit\n> ",
        );
        if (action === QUIT) return undefined;
        if (action === BACK) break;
        const key = action.toLowerCase();
        if (key === "q") return undefined;
        if (key === "b" || key === "") break;
        if (key === "r") {
          const answer = await ask("Rating 1-5, optionally followed by a note: ");
          if (answer === QUIT) return undefined;
          if (answer === BACK || !answer) continue;
          try {
            const { rating, notes } = parseRating(answer.split(/\s+/));
            store.rateRide(ride.id, rating, notes);
            console.log(`Rated #${ride.id} ${rating}/5.`);
          } catch (error) {
            console.log(describeError(error));
          }
          continue;
        }
        if (key === "g") {
          try {
            const { path } = await exportSavedRide(store, ride, undefined);
            console.log(`GPX written: ${path}`);
            ride = store.findRide(String(ride.id)) ?? ride;
          } catch (error) {
            console.log(describeError(error));
          }
          continue;
        }
        if (key === "e" || key === "v") {
          // Straight to the free prompt; the model is only called once the rider types.
          return { prompt: null, baseRide: ride, home: values.from };
        }
        console.log("Type e, g, r, b or q.");
      }
      continue;
    }
    console.log("Type 1, 2 or q.");
  }
}

/** The free prompt on the current ride. Returns whether to go back to the menu or quit. */
/** The ride to hand to the phone: the itinerary on screen, else the saved or loaded ride. */
async function sharedRide(session: RideSession, savedId: number | null): Promise<Shared | undefined> {
  const current = session.current();
  if (current) {
    const { trip, id } = current.route;
    const plan = session.context.stopPlans.get(id);
    const stops = (plan?.stops ?? []).map((s) => {
      const [lat = 0, lon = 0] = s.coords.split(",").map(Number);
      return { lat, lon, label: `${s.kind}: ${s.name} (${s.eta})`, km: s.kmAlongRoute };
    });
    const waypoints = [trip.result.legs[0]!, ...trip.result.legs].map((leg, i) => {
      const [lat = 0, lon = 0] = (i === 0 ? leg.fromCoords : leg.toCoords).split(",").map(Number);
      return { lat, lon };
    });
    lastShared = {
      name: current.title,
      mapsUrl: pinnedMapsLinks(waypoints, trip.shapes, stops)[0]!,
      itinerary: current.itinerary,
      gpx: {
        name: current.title,
        description: `${trip.result.totalDistanceKm} km, about ${trip.result.totalRidingTime} riding.`,
        legs: trip.result.legs,
        shapes: trip.shapes,
        stops,
      },
    };
    return lastShared;
  }
  const ride = savedId === null ? undefined : store.findRide(String(savedId));
  if (!ride) return undefined;
  const { gpx } = await savedRideGpx(store, ride);
  lastShared = { name: ride.name, mapsUrl: rideNavigation(ride).links[0]!, itinerary: ride.itinerary, gpx };
  return lastShared;
}

function sharedRideSync(session: RideSession, savedId: number | null): Shared | undefined {
  const current = session.current();
  if (current && current.itinerary !== lastShared?.itinerary) void sharedRide(session, savedId);
  return lastShared;
}

async function refineLoop(
  session: RideSession,
  requests: string[],
  save: (name?: string) => void,
  savedId: () => number | null,
  hasUnsaved: () => boolean,
  logRunNow: () => void,
  editing = false,
): Promise<Outcome> {
  console.log(
    editing
      ? '\nRide loaded. Type what to change ("50 km longer", "next Sunday, leave at 10", "skip Tournai") or ask a question about it.\nNothing is sent until you do. /show displays it again, /back returns to the menu, /help lists commands.'
      : "\nAsk for a change, /save to keep this ride, /back for the menu, /help for commands.",
  );
  // A setting changed by command is told to the model with the rider's next message.
  let pendingNote = "";
  // Leaving with an unsaved itinerary takes two tries, so it is never lost by accident.
  let warnedUnsaved = false;
  const mayLeave = (how: string) => {
    if (!hasUnsaved() || warnedUnsaved) return true;
    warnedUnsaved = true;
    console.log(
      `This itinerary is not saved and leaving discards it. /save to keep it, or ${how} again to leave anyway.`,
    );
    return false;
  };

  while (true) {
    // The prompt itself carries the motorway state, so it is never a guess.
    const motorways = session.context.preferences.avoidMotorways ? "motorways off" : "MOTORWAYS ON";
    const line = await prompter.ask(`\nrefine [${motorways}]> `);
    if (line === QUIT) return "quit";
    if (line === BACK) {
      if (mayLeave("Ctrl-D")) return "back";
      continue;
    }
    if (!line) continue; // an empty line does nothing; leaving is always explicit
    const lower = line.toLowerCase();
    if (["exit", "quit", "q", "/exit", "/quit", "/q"].includes(lower)) {
      if (mayLeave("/quit")) return "quit";
      continue;
    }
    if (["/back", "/menu", "/b"].includes(lower)) {
      if (mayLeave("/back")) return "back";
      continue;
    }

    try {
      if (line.startsWith("/")) {
        const [command = "", ...args] = line.slice(1).split(/\s+/);
        switch (command.toLowerCase()) {
          case "save":
            save(args.join(" "));
            break;
          case "list":
            console.log(formatRideList(store.listRides()));
            break;
          case "show": {
            // Without an argument: the ride this session saved or loaded.
            const target = args.length ? args.join(" ") : savedId() !== null ? String(savedId()) : undefined;
            const ride = target ? store.findRide(target) : undefined;
            console.log(ride ? formatRideDetail(ride) : "Usage: /show <id|name>, see /list.");
            break;
          }
          case "rate": {
            const id = savedId();
            if (id === null) {
              console.log("No saved ride in this session yet. /save first, or use: npm run rides -- rate <id> <1-5>");
              break;
            }
            const { rating, notes } = parseRating(args);
            store.rateRide(id, rating, notes);
            console.log(`Rated #${id} ${rating}/5.`);
            break;
          }
          case "note": {
            const flag = (name: string) => {
              const at = args.indexOf(name);
              return at >= 0 ? args.splice(at, 2)[1] : undefined;
            };
            const rating = flag("--rating");
            const back = flag("--back");
            const text = args.join(" ").trim();
            if (!text) {
              console.log("Usage: /note <text> [--rating 0-5] [--back N], e.g. /note last 10 min awesome --rating 5");
              break;
            }
            const id = savedId();
            const { ride } = addRideNote(store, {
              ride: id === null ? undefined : String(id),
              text,
              rating: rating === undefined ? null : Number(rating),
              minutesBack: back === undefined ? undefined : Number(back),
            });
            console.log(`Noted on #${ride.id} "${ride.name}". Review it after the ride: npm run rides -- review`);
            break;
          }
          case "motorways": {
            const preferences = session.context.preferences;
            const wanted = args[0]?.toLowerCase();
            if (wanted !== "on" && wanted !== "off") {
              console.log(
                `Motorways are ${preferences.avoidMotorways ? "forbidden" : "permitted"}. Use /motorways on or /motorways off.`,
              );
              break;
            }
            preferences.avoidMotorways = wanted === "off";
            pendingNote = preferences.avoidMotorways
              ? "[Setting changed by the rider: motorways are now forbidden. Any trip must be routed without them.]"
              : "[Setting changed by the rider: motorways are now permitted. For a leisure ride, only to reach the riding area; for a practical trip, use them freely.]";
            console.log(
              `Motorways ${preferences.avoidMotorways ? "forbidden" : "permitted"} from now on. Ask for the change you want, e.g. "route it with motorways".`,
            );
            break;
          }
          case "settings":
            console.log(describeSettings(session.context.home.label, session.context.preferences));
            console.log(`Bike: ${describeProfile(store.getProfile())}`);
            break;
          case "bike": {
            const profile = args.length ? store.setProfile(parseProfileArgs(args)) : store.getProfile();
            console.log(`Bike profile: ${describeProfile(profile)}`);
            if (args.length)
              pendingNote = `[Setting changed by the rider: bike profile is now ${describeProfile(profile)}. Plan stops again if an itinerary is on the table.]`;
            break;
          }
          case "usage":
            console.log(formatUsage(session.usage()));
            break;
          case "trace": {
            logRunNow();
            const run = store.findRun(session.context.runId)!;
            console.log(formatTrace(run, store.listTrace(run.id), args.includes("--full")));
            break;
          }
          case "md": {
            const id = savedId();
            const ride = id === null ? undefined : store.findRide(String(id));
            if (!ride) {
              console.log("Markdown is exported from a saved ride: /save first, then /md.");
              break;
            }
            if (hasUnsaved()) console.log("Note: the itinerary on screen is not saved; exporting the saved version.");
            console.log(`Markdown written: ${writeRideMarkdown(ride, args.join(" ") || undefined)}`);
            break;
          }
          case "qr": {
            const shared = await sharedRide(session, savedId());
            if (!shared) {
              console.log("Nothing to show yet: no itinerary in this session.");
              break;
            }
            console.log(`${shared.name}\n${shared.mapsUrl}`);
            await printQr(shared.mapsUrl);
            break;
          }
          case "share": {
            const shared = await sharedRide(session, savedId());
            if (!shared) {
              console.log("Nothing to share yet: no itinerary in this session.");
              break;
            }
            if (!shareUrl) {
              const port = Number(process.env.RIDE_SHARE_PORT) || 8787;
              const started = await startShareServer(() => sharedRideSync(session, savedId()), port);
              shareServer = started.server;
              shareUrl = started.url;
            }
            console.log(
              `Scan with the phone (same Wi-Fi): ${shareUrl}\nThe page follows the current itinerary and stays up until you quit.`,
            );
            await printQr(shareUrl);
            break;
          }
          case "gpx": {
            const file = args.join(" ") || undefined;
            const current = session.current();
            if (current) {
              // The itinerary on screen, saved or not, with its exact routed line.
              const { trip, id } = current.route;
              const planned = (session.context.stopPlans.get(id)?.stops ?? []).map((s) => {
                const [lat = 0, lon = 0] = s.coords.split(",").map(Number);
                return { lat, lon, label: `${s.kind}: ${s.name} (${s.eta})`, km: s.kmAlongRoute };
              });
              const path = writeGpx(
                {
                  name: current.title,
                  description: `${trip.result.totalDistanceKm} km, about ${trip.result.totalRidingTime} riding. Planned with agentMotoride.`,
                  legs: trip.result.legs,
                  shapes: trip.shapes,
                  stops: planned,
                },
                savedId() ?? id,
                file,
              );
              console.log(`GPX written: ${path}`);
            } else if (savedId() !== null) {
              const { path } = await exportSavedRide(store, store.findRide(String(savedId()))!, file);
              console.log(`GPX written: ${path}`);
            } else {
              console.log("Nothing to export yet: no itinerary in this session.");
            }
            break;
          }
          case "help":
            console.log(refineHelp());
            break;
          default:
            console.log(`Unknown command /${command}.\n${refineHelp()}`);
        }
        continue;
      }
      await session.send(pendingNote ? `${pendingNote}\n${line}` : line);
      pendingNote = "";
      warnedUnsaved = false;
    } catch (error) {
      // A failed follow-up leaves the previous itinerary and conversation intact.
      console.error(`${describeError(error)}\nThe previous itinerary still stands; try again or rephrase.`);
    }
  }
}
