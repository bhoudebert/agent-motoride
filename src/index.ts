import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { startRide } from "./agent.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";

const USAGE = `Usage: npm run ride -- [--from <place>] "<what you want>"

  npm run ride -- --from "Grenoble" "Roadtrip moto this Saturday, no rain, <250km, winding roads, give me an itinerary"

Options:
  --from <place>        Start and end point. Defaults to RIDE_HOME.
  --allow-motorways     Permit motorways (autoroutes). Default: never used.
  --max-30-pct <n>      Target max % of distance in zones of 30 km/h or less. Default ${DEFAULT_PREFERENCES.max30Pct}.
  --max-50-pct <n>      Target max % of distance in 31-50 km/h zones. Default ${DEFAULT_PREFERENCES.max50Pct}.
  --once                Print the itinerary and exit, without the refine prompt.

After the itinerary, a "refine>" prompt lets you ask for changes ("shorter",
"leave at 10", "skip Die", "more passes"). Empty line, "exit" or Ctrl-D quits.

Env equivalents: RIDE_ALLOW_MOTORWAYS=1, RIDE_MAX_30_PCT, RIDE_MAX_50_PCT.
Needs ANTHROPIC_API_KEY (see .env.example).`;

const { values, positionals } = parseArgs({
  options: {
    from: { type: "string" },
    "allow-motorways": { type: "boolean" },
    "max-30-pct": { type: "string" },
    "max-50-pct": { type: "string" },
    once: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});
const prompt = positionals.join(" ").trim();
const home = values.from ?? process.env.RIDE_HOME;

if (values.help || !prompt) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
if (!home) {
  console.error(`No start point: pass --from "<place>" or set RIDE_HOME.\n\n${USAGE}`);
  process.exit(1);
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

const preferences = {
  avoidMotorways: !(values["allow-motorways"] ?? ["1", "true"].includes(process.env.RIDE_ALLOW_MOTORWAYS ?? "")),
  max30Pct: percent("--max-30-pct", values["max-30-pct"] ?? process.env.RIDE_MAX_30_PCT, DEFAULT_PREFERENCES.max30Pct),
  max50Pct: percent("--max-50-pct", values["max-50-pct"] ?? process.env.RIDE_MAX_50_PCT, DEFAULT_PREFERENCES.max50Pct),
};

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Claude API rejected the credentials. Check ANTHROPIC_API_KEY in .env.";
  }
  if (error instanceof Anthropic.RateLimitError) return "Claude API rate limit hit. Retry in a minute.";
  if (error instanceof Anthropic.APIConnectionError) return `Could not reach the Claude API: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

try {
  const session = await startRide({ prompt, home, preferences });

  // Refine loop: only when a person is at the terminal.
  if (!values.once && process.stdin.isTTY && process.stdout.isTTY) {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    readline.on("SIGINT", () => readline.close());
    console.log('\nAsk for a change, or press Enter to quit.');
    while (true) {
      let line: string;
      try {
        line = (await readline.question("\nrefine> ")).trim();
      } catch {
        break; // Ctrl-D or Ctrl-C closed the prompt
      }
      if (!line || ["exit", "quit", "q"].includes(line.toLowerCase())) break;
      try {
        await session.send(line);
      } catch (error) {
        // A failed follow-up leaves the previous itinerary and conversation intact.
        console.error(`${describeError(error)}\nThe previous itinerary still stands; try again or rephrase.`);
      }
    }
    readline.close();
  }
} catch (error) {
  console.error(describeError(error));
  process.exit(1);
}
