import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { startRide, type RideSession } from "./agent.ts";
import { formatRideDetail, formatRideList, parseRating, saveCurrentRide } from "./library.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";
import { Store, type SavedRide } from "./store.ts";

const USAGE = `Usage: npm run ride -- [options] "<what you want>"

  npm run ride -- --from "Grenoble" "Roadtrip moto this Saturday, no rain, <250km, winding roads, give me an itinerary"
  npm run ride -- --ride 3 "same ride next Sunday, 50 km longer, lunch in Die"

Options:
  --from <place>        Start and end point. Defaults to RIDE_HOME, or the saved ride's start with --ride.
  --ride <id|name>      Evolve a saved ride instead of planning from scratch.
  --allow-repeat        Accept rides that repeat saved ones. Default: near-duplicates are rejected.
  --save-as <name>      Save the first itinerary under this name (useful with --once).
  --allow-motorways     Permit motorways (autoroutes). Default: never used.
  --max-30-pct <n>      Target max % of distance in zones of 30 km/h or less. Default ${DEFAULT_PREFERENCES.max30Pct}.
  --max-50-pct <n>      Target max % of distance in 31-50 km/h zones. Default ${DEFAULT_PREFERENCES.max50Pct}.
  --once                Print the itinerary and exit, without the refine prompt.

At the "refine>" prompt, type a change in plain words, or a command:
${refineHelp()}

Saved rides are managed with: npm run rides -- list | show | rate | rate-leg | delete
Env equivalents: RIDE_ALLOW_MOTORWAYS=1, RIDE_MAX_30_PCT, RIDE_MAX_50_PCT.
Needs ANTHROPIC_API_KEY (see .env.example).`;

function refineHelp(): string {
  return `  /save [name]          Save the current itinerary (new version if already saved)
  /list                 Saved rides
  /show <id|name>       Details of a saved ride
  /rate <1-5> [note]    Rate the ride saved or loaded in this session
  /help                 This list
  Enter, exit, Ctrl-D   Quit`;
}

const { values, positionals } = parseArgs({
  options: {
    from: { type: "string" },
    ride: { type: "string" },
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

if (values.help || (!positionals.length && !values.ride)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
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

const store = new Store();
let exitCode = 0;

try {
  store.cachePurgeExpired();

  let baseRide: SavedRide | undefined;
  if (values.ride) {
    baseRide = store.findRide(values.ride);
    if (!baseRide) throw new Error(`No saved ride matches "${values.ride}". Run: npm run rides -- list`);
  }
  const home = values.from ?? baseRide?.home ?? process.env.RIDE_HOME;
  if (!home) throw new Error('No start point: pass --from "<place>" or set RIDE_HOME.');
  const prompt =
    positionals.join(" ").trim() ||
    "Plan this saved ride again for the coming Saturday or Sunday, whichever has the better weather, and update the itinerary.";

  const preferences = {
    avoidMotorways: !(values["allow-motorways"] ?? ["1", "true"].includes(process.env.RIDE_ALLOW_MOTORWAYS ?? "")),
    max30Pct: percent("--max-30-pct", values["max-30-pct"] ?? process.env.RIDE_MAX_30_PCT, DEFAULT_PREFERENCES.max30Pct),
    max50Pct: percent("--max-50-pct", values["max-50-pct"] ?? process.env.RIDE_MAX_50_PCT, DEFAULT_PREFERENCES.max50Pct),
  };

  if (baseRide) console.error(`Evolving saved ride #${baseRide.id} "${baseRide.name}".`);
  const session = await startRide({
    prompt,
    home,
    store,
    preferences,
    allowRepeat: values["allow-repeat"] ?? false,
    baseRide,
  });

  // The saved ride this session's work descends from: the loaded one, then each save.
  let savedId: number | null = baseRide?.id ?? null;
  let savedItinerary: string | null = null;
  const requests = [prompt];

  const save = (name?: string) => {
    const ride = session.current();
    if (!ride) {
      console.log("Nothing to save yet: the last answer did not contain a routed itinerary. Ask for one, then /save.");
      return;
    }
    if (ride.itinerary === savedItinerary) {
      console.log(`Already saved as #${savedId}. Change the ride first to save a new version.`);
      return;
    }
    const id = saveCurrentRide(session.context, ride, {
      name,
      request: requests.join(" / "),
      parentId: savedId,
      home,
    });
    const version = savedId ? ` (new version of #${savedId})` : "";
    savedId = id;
    savedItinerary = ride.itinerary;
    console.log(`Saved as #${id} "${store.findRide(String(id))!.name}"${version}, ${ride.route.trip.result.totalDistanceKm} km.`);
  };

  if (values["save-as"]) save(values["save-as"]);

  // Refine loop: only when a person is at the terminal.
  if (!values.once && process.stdin.isTTY && process.stdout.isTTY) {
    await refineLoop(session, requests, save, () => savedId);
  }
} catch (error) {
  console.error(describeError(error));
  exitCode = 1;
} finally {
  store.close();
}
process.exit(exitCode);

async function refineLoop(
  session: RideSession,
  requests: string[],
  save: (name?: string) => void,
  savedId: () => number | null,
): Promise<void> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  readline.on("SIGINT", () => readline.close());
  console.log("\nAsk for a change, /save to keep this ride, /help for commands, Enter to quit.");
  while (true) {
    let line: string;
    try {
      line = (await readline.question("\nrefine> ")).trim();
    } catch {
      break; // Ctrl-D or Ctrl-C closed the prompt
    }
    if (!line || ["exit", "quit", "q", "/exit", "/quit"].includes(line.toLowerCase())) break;

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
            const ride = args.length ? store.findRide(args.join(" ")) : undefined;
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
          case "help":
            console.log(refineHelp());
            break;
          default:
            console.log(`Unknown command /${command}.\n${refineHelp()}`);
        }
        continue;
      }
      await session.send(line);
      requests.push(line);
    } catch (error) {
      // A failed follow-up leaves the previous itinerary and conversation intact.
      console.error(`${describeError(error)}\nThe previous itinerary still stands; try again or rephrase.`);
    }
  }
  readline.close();
}
