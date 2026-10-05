// npm run eval                          replay every recorded case: no network, no cost (what CI runs)
// npm run eval -- --update-tools        replay, fetching missing map/weather answers live (free) into the cassettes
// npm run eval -- --record [ids] [--budget 3]   run cases live on the Claude API and record them (billed)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Cassette } from "./cassette.ts";
import { CASES } from "./cases.ts";
import { tierOf } from "./graders.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    record: { type: "boolean", default: false },
    "update-tools": { type: "boolean", default: false },
    budget: { type: "string", default: "3" },
    verbose: { type: "boolean", default: false },
  },
});

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "cassettes");
const fileOf = (id: string) => resolve(DIR, `${id}.json`);
const cases = positionals.length ? CASES.filter((c) => positionals.includes(c.id)) : CASES;
const unknown = positionals.filter((id) => !CASES.some((c) => c.id === id));
if (unknown.length) {
  console.error(`Unknown case(s): ${unknown.join(", ")}. Cases: ${CASES.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

if (!values.record) {
  // A replay never needs, and must never use, real credentials.
  process.env.ANTHROPIC_API_KEY = "replay-no-network";
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_BASE_URL;
} else if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  throw new Error("Recording runs the cases on the Claude API: set ANTHROPIC_API_KEY in .env.");
}
// After the credentials are settled: the planner reads them when it starts a session.
const { regressions, runCase } = await import("./harness.ts");

const budget = Number(values.budget);
let spent = 0;
let failed = false;
const rows: string[] = [];

for (const c of cases) {
  let cassette: Cassette | undefined;
  if (!values.record) {
    if (!existsSync(fileOf(c.id))) {
      rows.push(`${c.id.padEnd(22)} not recorded`);
      continue;
    }
    cassette = JSON.parse(readFileSync(fileOf(c.id), "utf8")) as Cassette;
  } else if (spent >= budget) {
    rows.push(`${c.id.padEnd(22)} skipped: budget of $${budget} reached`);
    continue;
  }

  process.stderr.write(`${values.record ? "recording" : "replaying"} ${c.id}...\n`);
  const run = await runCase(c, { cassette, updateTools: values["update-tools"], verbose: values.verbose });
  const names = Object.keys(run.scores);
  const passed = names.filter((n) => run.scores[n]).length;
  const ruleFailures = names.filter((n) => !run.scores[n] && tierOf(n) === "rule");
  const regressed = cassette ? regressions(cassette.scores, run.scores) : [];
  const failing = names.filter((n) => !run.scores[n]);

  if (values.record) {
    spent += run.costUsd;
    mkdirSync(DIR, { recursive: true });
    writeFileSync(fileOf(c.id), `${JSON.stringify(run.cassette, null, 1)}\n`);
  } else if (run.added.length) {
    writeFileSync(fileOf(c.id), `${JSON.stringify(run.cassette, null, 1)}\n`);
  }
  if (ruleFailures.length || regressed.length || (!values["update-tools"] && run.misses.length)) failed = true;

  rows.push(
    [
      c.id.padEnd(22),
      `${passed}/${names.length}`.padEnd(6),
      values.record ? `$${run.costUsd.toFixed(2)}`.padEnd(7) : `rec $${cassette!.costUsd.toFixed(2)}`.padEnd(11),
      failing.length ? `failing: ${failing.join(", ")}` : "all pass",
      ruleFailures.length ? ` | RULE BROKEN: ${ruleFailures.join(", ")}` : "",
      regressed.length ? ` | REGRESSED: ${regressed.join(", ")}` : "",
      run.misses.length ? ` | ${run.misses.length} not in cassette (${run.misses[0]})` : "",
      run.drift.length ? ` | ${run.drift.length} model step(s) see a changed request` : "",
      run.added.length ? ` | ${run.added.length} tool answer(s) added` : "",
    ].join(""),
  );
}

console.log(rows.join("\n"));
if (values.record) console.log(`\nSpent about $${spent.toFixed(2)} (estimate from list prices).`);
if (rows.some((r) => r.includes("not in cassette"))) {
  console.log(
    "\nA tool request is missing: the code now asks the map or weather services something new. Refresh for free with: npm run eval -- --update-tools",
  );
}
process.exitCode = failed ? 1 : 0;
