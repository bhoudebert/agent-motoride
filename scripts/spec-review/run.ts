import { blocks } from "./verify.ts";
import { runChecks } from "./checks.ts";
import type { Provider } from "./provider.ts";
import { notRequested, reviewWithModel, type ReviewOptions } from "./review.ts";
import type { NoSpec, Report, Source } from "./types.ts";
import { validateSpecs, type SpecValidation } from "./openspecCheck.ts";

export interface RunOptions extends ReviewOptions {
  noSpec?: NoSpec;
  provider?: Provider | null;
  /** Validate the specs with the openspec tool; false when another job already does. */
  openspec?: boolean | (() => SpecValidation);
  /** A review that did not complete also blocks. */
  requireReview?: boolean;
  cwd?: string;
}

/** The whole review of a change: the deterministic checks, then the model's, if one is given. */
export async function runReview(source: Source, options: RunOptions = {}): Promise<Report> {
  const checks = runChecks(source, options.noSpec);
  const findings = [...checks.findings];
  const skippedChecks: string[] = [];

  if (options.openspec === false) skippedChecks.push("openspec validate: left to another job");
  else {
    const validation = typeof options.openspec === "function" ? options.openspec() : validateSpecs(options.cwd ?? ".");
    if (validation.state === "failed")
      findings.push({
        rule: "openspec-validate",
        level: "error",
        message: `openspec validate failed:\n${validation.output}`,
        file: "openspec/",
      });
    else if (validation.state === "skipped") skippedChecks.push(`openspec validate: ${validation.reason}`);
  }

  const review = options.provider
    ? await reviewWithModel(source, checks.touched, checks.map, options.provider, options)
    : notRequested();

  const blockers = [
    ...findings
      .filter((f) => f.level === "error")
      .map((f) =>
        `${f.rule}: ${f.file ?? ""}${f.line ? `:${f.line}` : ""} ${f.message.split("\n")[0]}`.replace(/\s+/g, " "),
      ),
    ...review.findings
      .filter(blocks)
      .map(
        (f) =>
          `model: ${f.requirement} (${f.spec.file}:${f.spec.line} against ${f.code.file}:${f.code.line}) ${f.explanation}`,
      ),
  ];
  if (options.requireReview && options.provider && review.status.state !== "completed")
    blockers.push(`model review ${review.status.state}${"reason" in review.status ? `: ${review.status.reason}` : ""}`);

  return {
    base: source.base,
    head: source.head,
    changed: source.changed,
    touched: checks.touched,
    unmapped: checks.unmapped,
    noSpec: checks.noSpec,
    skippedChecks,
    findings,
    review,
    blockers,
  };
}
