import { globToRegExp } from "./glob.ts";
import {
  adrFile,
  capabilitiesOf,
  capabilitiesOfTree,
  CODE_MAP_PATH,
  citedRecords,
  openProposals,
  readCodeMap,
  specPath,
  type CodeMap,
} from "./specs.ts";
import type { Finding, NoSpec, Source, Touched } from "./types.ts";

const isCode = (path: string) => path.startsWith("src/");
const isTest = (path: string) => path.startsWith("test/");
const proposalOf = (path: string) => {
  const id = /^openspec\/changes\/([^/]+)\//.exec(path)?.[1];
  return id && id !== "archive" ? id : undefined;
};

/** The reason a change has no behaviour change, from the option, or a `No-Spec: <reason>` line of a commit. */
export function findNoSpec(source: Source, option?: NoSpec): NoSpec | null {
  if (option) return option;
  for (const message of source.messages) {
    const reason = /^No-Spec:\s*(\S.*)$/im.exec(message)?.[1]?.trim();
    if (reason) return { reason, source: "commit" };
  }
  return null;
}

export interface CheckResult {
  findings: Finding[];
  touched: Touched[];
  unmapped: string[];
  noSpec: NoSpec | null;
  map: CodeMap;
}

export function runChecks(source: Source, option?: NoSpec): CheckResult {
  const findings: Finding[] = [];
  const touched = new Map<string, string[]>();
  const touch = (capability: string, reason: string) => {
    const reasons = touched.get(capability) ?? touched.set(capability, []).get(capability)!;
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  const { map, error } = readCodeMap(source);
  if (error)
    findings.push({
      rule: "code-map",
      level: "warning",
      message: `${error}: code files cannot be tied to a capability.`,
      file: CODE_MAP_PATH,
    });
  const known = capabilitiesOfTree(source.tree);

  // Spec evidence: a changed spec, or a changed file of an open proposal that names the capability.
  const proposals = openProposals(source.tree);
  const evidence = new Set<string>();
  let anyEvidence = false;
  for (const file of source.changed) {
    const spec = /^openspec\/specs\/([^/]+)\/spec\.md$/.exec(file.path)?.[1];
    if (spec) {
      evidence.add(spec);
      anyEvidence = true;
      touch(spec, `${specPath(spec)} changed`);
    }
    const id = proposalOf(file.path);
    if (id) {
      anyEvidence = true;
      for (const c of proposals.find((p) => p.id === id)?.capabilities ?? []) {
        evidence.add(c);
        touch(c, `proposal ${id} changed`);
      }
    }
  }

  const noSpec = findNoSpec(source, option);
  const unmapped: string[] = [];
  const docsChanged = source.changed.some((f) => f.path.startsWith("docs/"));
  for (const file of source.changed) {
    const paths = [file.path, ...(file.oldPath ? [file.oldPath] : [])];
    for (const path of paths) {
      if (isTest(path) || path.startsWith("evals/"))
        for (const c of capabilitiesOf(map, path, "tests")) touch(c, `${path} (tests)`);
    }
    if (!isCode(file.path) && !(file.oldPath && isCode(file.oldPath))) continue;
    const capabilities = [...new Set(paths.flatMap((p) => capabilitiesOf(map, p, "code")))];
    capabilities.forEach((c) => touch(c, `${file.path} (code map)`));
    if (capabilities.length === 0) {
      unmapped.push(file.path);
      findings.push({
        rule: "unmapped-file",
        level: "warning",
        message: `${file.path} is in no entry of ${CODE_MAP_PATH}: add it, so the spec it belongs to can be found.`,
        file: file.path,
      });
    }
    const covered = capabilities.length === 0 ? anyEvidence : capabilities.some((c) => evidence.has(c));
    if (covered) continue;
    const where = capabilities.length ? `the spec of ${capabilities.join(" or ")}` : "a spec or an open proposal";
    findings.push({
      rule: "code-without-spec",
      level: noSpec ? "info" : "error",
      message: noSpec
        ? `${file.path} changes with no spec change, accepted: no behaviour change (${noSpec.reason}).`
        : `${file.path} changes but ${where} does not${docsChanged ? " (a change under docs/ is not a spec change)" : ""}. Update the requirement, or state that the behaviour is unchanged: the \`no-spec\` label, or a \`No-Spec: <reason>\` line in a commit.`,
      file: file.path,
      capability: capabilities.join(", ") || undefined,
    });
  }

  findings.push(...codeMapFindings(source, map, known));
  findings.push(...referenceFindings(source));

  return {
    findings,
    touched: [...touched]
      .map(([capability, reasons]) => ({ capability, reasons }))
      .sort((a, b) => a.capability.localeCompare(b.capability)),
    unmapped,
    noSpec,
    map,
  };
}

/** A map that names a capability that has no spec, or a pattern that matches no file, has fallen behind. */
function codeMapFindings(source: Source, map: CodeMap, known: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const [capability, entry] of Object.entries(map)) {
    if (!known.includes(capability))
      findings.push({
        rule: "code-map",
        level: "warning",
        message: `${CODE_MAP_PATH} names the capability "${capability}", which has no spec.`,
        file: CODE_MAP_PATH,
      });
    for (const glob of [...entry.code, ...entry.tests]) {
      const re = globToRegExp(glob);
      if (!source.tree.some((p) => re.test(p)))
        findings.push({
          rule: "code-map",
          level: "warning",
          message: `${CODE_MAP_PATH}: "${glob}" (${capability}) matches no file.`,
          file: CODE_MAP_PATH,
        });
    }
  }
  return findings;
}

const referencing = (path: string) =>
  path.endsWith(".md") &&
  (path.startsWith("openspec/") || path.startsWith("docs/")) &&
  !path.startsWith("docs/guide/.vitepress/") &&
  !path.startsWith("openspec/changes/archive/");

/** In the documents a change touches: records and spec paths that do not exist. */
function referenceFindings(source: Source): Finding[] {
  const findings: Finding[] = [];
  const has = (prefix: string) => source.tree.some((p) => p.startsWith(prefix));
  for (const file of source.changed) {
    if (file.status === "deleted" || !referencing(file.path)) continue;
    const text = source.readHead(file.path);
    if (text === undefined) continue;
    const reported = new Set<string>();
    for (const { number, line } of citedRecords(text)) {
      if (adrFile(source.tree, number) || reported.has(`adr${number}`)) continue;
      reported.add(`adr${number}`);
      findings.push({
        rule: "broken-reference",
        level: "error",
        message: `ADR ${number} does not exist in docs/adr/.`,
        file: file.path,
        line,
      });
    }
    text.split("\n").forEach((content, i) => {
      for (const m of content.matchAll(/openspec\/(specs|changes)\/([a-z0-9][a-z0-9-]*)/g)) {
        if (m[2] === "archive") continue;
        const path = `openspec/${m[1]}/${m[2]}`;
        if (has(`${path}/`) || reported.has(path)) continue;
        reported.add(path);
        findings.push({
          rule: "broken-reference",
          level: "error",
          message: `${path} does not exist.`,
          file: file.path,
          line: i + 1,
        });
      }
    });
  }
  return findings;
}
