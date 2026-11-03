import type { Report } from "../../scripts/spec-review/types.ts";
import type { Scenario } from "./scenarios.ts";

export interface Score {
  id: string;
  /** The deterministic checks reported exactly the errors expected. */
  deterministicOk: boolean;
  truePositives: number;
  falsePositives: number;
  missed: number;
}

/** Compares what a review reported with what the scenario is labelled to contain. */
export function scoreScenario(scenario: Scenario, report: Report): Score {
  const errors = [...new Set(report.findings.filter((f) => f.level === "error").map((f) => f.rule))].sort();
  const reported = new Set(report.review.findings.map((f) => f.requirement));
  const expected = new Set(scenario.expect.contradictions);
  const truePositives = [...reported].filter((r) => expected.has(r)).length;
  return {
    id: scenario.id,
    deterministicOk: JSON.stringify(errors) === JSON.stringify([...scenario.expect.errors].sort()),
    truePositives,
    falsePositives: reported.size - truePositives,
    missed: expected.size - truePositives,
  };
}

export function total(scores: Score[]) {
  const sum = (key: "truePositives" | "falsePositives" | "missed") => scores.reduce((n, s) => n + s[key], 0);
  const tp = sum("truePositives");
  const fp = sum("falsePositives");
  const missed = sum("missed");
  return {
    truePositives: tp,
    falsePositives: fp,
    missed,
    precision: tp + fp === 0 ? null : tp / (tp + fp),
    recall: tp + missed === 0 ? null : tp / (tp + missed),
  };
}
