import { gitSource } from "../scripts/spec-review/git.ts";
import { ollama } from "../scripts/spec-review/provider.ts";
import { runReview } from "../scripts/spec-review/run.ts";
import { buildRepo } from "./spec-review/repo.ts";
import { scoreScenario, total, type Score } from "./spec-review/score.ts";
import { BASE, SCENARIOS } from "./spec-review/scenarios.ts";

// `npm run spec:eval -- <model>`: the labelled scenarios against a real local model (Ollama). It prints what the
// model found, wrongly flagged and missed; no number here says a model keeps the specs consistent.
const model = process.argv[2] ?? process.env.SPEC_REVIEW_MODEL;
if (!model) {
  console.error("Usage: npm run spec:eval -- <ollama model>   (or set SPEC_REVIEW_MODEL)");
  process.exit(2);
}
const provider = ollama({ model, host: process.env.OLLAMA_HOST });

const scores: Score[] = [];
let wrongBlocks = 0;
let rightBlocks = 0;
for (const scenario of SCENARIOS) {
  const repo = buildRepo(BASE, scenario.head, scenario.messages);
  try {
    const report = await runReview(gitSource(repo.dir, repo.base, repo.head), { provider, openspec: false });
    const state = report.review.status.state;
    const score = scoreScenario(scenario, report);
    scores.push(score);
    // The hook blocks on a verified high finding of medium or high confidence: wrong when nothing was labelled.
    const blocks = report.blockers.filter((b) => b.startsWith("model:")).length;
    if (scenario.expect.contradictions.length) rightBlocks += blocks ? 1 : 0;
    else wrongBlocks += blocks ? 1 : 0;
    console.log(
      `${scenario.id.padEnd(26)} review ${state.padEnd(11)} tp ${score.truePositives}  fp ${score.falsePositives}  missed ${score.missed}  rejected ${report.review.rejected.length}  would block ${blocks}  deterministic ${score.deterministicOk ? "ok" : "WRONG"}`,
    );
  } finally {
    repo.cleanup();
  }
}
const t = total(scores);
const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
console.log(
  `\n${model}: true positives ${t.truePositives}, false positives ${t.falsePositives}, missed ${t.missed}; precision ${pct(t.precision)}, recall ${pct(t.recall)}`,
);
console.log(
  `The hook would block ${rightBlocks} of ${SCENARIOS.filter((s) => s.expect.contradictions.length).length} changes with a labelled contradiction, and ${wrongBlocks} of ${SCENARIOS.filter((s) => !s.expect.contradictions.length).length} changes with none.`,
);
console.log("Few scenarios: read it as a smoke test of the model and the prompt, not as a guarantee.");
