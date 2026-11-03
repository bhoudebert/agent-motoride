# How agentMotoride evolves

Every feature goes through the same path, whoever builds it, a person or a
coding agent. The path exists so that each change is designed before it is
coded, specified before it is tested, and explained before it is released.

```
idea ─▶ decision ─▶ spec ─▶ code + tests ─▶ docs ─▶ showcase ─▶ PR ─▶ release
        (ADR)      (openspec)  (all modes)   (guide)   (site)    (review) (automatic)
```

## 1. Idea

Ideas live in `ROADMAP.md` or an issue. Before building, talk it through:
who is it for, when is it used (before, during, after the ride), what does the
rider do, what does the app do. A feature that cannot be described in those
terms is not ready.

## 2. Decision: an ADR when the shape of the system changes

New data store or table, new execution path, new dependency or service, a rule
that cuts across features, a choice between real alternatives: write a record
in `docs/adr/` from `template.md`, with the alternatives that lost. Small
features inside an existing shape need no record.

## 3. Spec: what the system shall do

Update or add `openspec/specs/<capability>/spec.md`: requirements written as
SHALL statements, each with at least one scenario (WHEN / THEN). A new
capability gets its own folder and a line in `openspec/README.md`. The spec is
written first and reviewed with the code in the same pull request: edit
`specs/` directly, no proposal needed.

A change proposal (`openspec/changes/<id>/`) is the exception, for a feature
that spans several pull requests or whose design is agreed before any code. It
is archived into `specs/` (`openspec archive <id>`) in the last pull request
of that feature, not in one of its own. `openspec/README.md` explains both.

CI checks it (ADR 0044, ADR 0058): the specs and any open proposal must pass `openspec validate --all`
(run it in the dev shell, `nix develop`), and a pull request that changes `src/` must also change the spec of what it
touches: `openspec/specs/<capability>/spec.md`, or a file of an open proposal for that capability. **A change to the
docs does not count as a spec change.** A change with no behaviour change (a refactor, an internal fix) says so: the
`no-spec` label on the pull request, or a `No-Spec: <reason>` line in one of its commits.

### Checking a change against the specs

```bash
npm run spec:review -- --base origin/main --head HEAD                      # deterministic checks, no model
npm run spec:review -- --base origin/main --head HEAD --provider ollama --model qwen3:8b   # and a local model
```

It writes `.spec-review/report.json` and `report.md` (Git ignores them) and changes nothing else. A person, Claude Code or
Codex can run it before opening a pull request; the Markdown report is made to be read.

- **Deterministic checks** (the ones that decide, and the ones CI runs, with no model and no secret): the specs validate;
  `src/` changed with a spec change for its capability, an open proposal's, or a stated reason; cited records
  (`ADR 0044`) and spec paths (`openspec/specs/<name>`) exist in the documents the change touches (name another repository's
  spec without writing it as a path of this one). `openspec/code-map.json` maps code and test files to capabilities, so a diff can be
  tied to its requirements: a file missing from it is a warning, and the check then accepts any spec change. Keep the
  map up to date when a file is added; the review warns about patterns that match nothing.
- **A local model** (optional, [Ollama](https://ollama.com), no key and no cost) reads, per touched capability, its
  requirements, the records it cites, the diff and the titles of its tests, and looks for a contradiction, a changed
  threshold the spec does not say, a requirement the change made stale, a conflict with a record, a missing test.
  Every finding must quote the spec and the code; **the program looks for each quote in the file and drops the finding
  when it is not there**. What is read is data, never instructions. The model never edits anything.
  The report always says whether the model review ran: not requested, nothing to review, unavailable (Ollama not
  running, model not pulled), failed (an answer that is not valid JSON), or completed. Unavailable is not "found nothing".
- **What blocks**: a deterministic error; a verified finding of severity `high` and confidence `medium` or `high`. Every
  other finding is advice. A local model is wrong sometimes, in both directions: a finding is a lead for the author.
- **The `pre-push` hook** (installed with `npm install`, or `npx simple-git-hooks`) runs the deterministic checks on every
  push, and the model when `SPEC_REVIEW_MODEL` is set (in `.env`; see `.env.example`) and Ollama answers. It blocks the push
  on a blocking finding. If the review cannot run it says so and lets the push go: only the checks of the pull
  request are the rule. A hook is a convenience on one machine: `git push --no-verify` or `SKIP_SPEC_REVIEW=1` skip it,
  and a fresh clone has no hook until `npm install`. The pull-request check cannot be skipped.
- **In CI** only the deterministic checks run, on the standard runner, as annotations on the files and a job summary. A
  model run in CI is left out for now: it needs a model downloaded on every run and nothing in it may block.
- **Measuring a model**: `npm run spec:eval -- <model>` runs the labelled scenarios in `evals/spec-review/` against a
  real Ollama and prints true positives, false positives and missed findings. There are few scenarios: it says whether a
  model and the prompt are usable at all, not that the specs are consistent.
  A first run, on 3 November 2026 with `llama3.1` (8 billion parameters): it reported both labelled contradictions
  (recall 2 of 2) and 10 findings on changes that had none (precision 17%), with real quotes in each. It rated every one
  `low` or `medium` severity, so the hook would have blocked nothing, right or wrong. At that quality the model is
  advice for the author. Try a larger model before trusting it with more, and read what it says.

## 4. Code and tests, in every mode

- **One implementation, every mode.** Logic lives in plain modules and tools
  (`src/tools/`, `src/*.ts`); the API planner, the MCP server and the CLI are
  thin entry points over it. A feature reachable in one mode is reachable in
  the others unless the spec says why not:
  - MCP: a tool (with `readOnlyHint` when it only reads) and, when useful, a
    prompt that becomes a slash command; mention it in the server instructions
    and in `/mcp__ride__help`.
  - API planner: the same tool through `createTools`; planner instructions
    updated when the model should use it.
  - CLI: a `npm run rides -- <command>` and/or a `/command` at the refine
    prompt; listed in `--help`.
  - **The catalogue**: an entry in `src/capabilities.ts` (what it does, what
    to say, the commands, the shortcut, the tools). The MCP help, the
    `capabilities` tool, `rides help`, the guide's "Everything you can do"
    page and the site's list are all rendered from it; a test fails when a
    tool, a prompt or a command is missing from it, and `npm run
docs:reference -- --check` when the page or the site list is stale.
- **Rules in code.** Anything that must always hold is enforced in the tool or
  the store, never only in a prompt.
- **Tests with the code.** Deterministic logic gets unit tests in `test/`;
  the planner loop runs against `test/helpers/fakeServices.ts`. Tests never
  reach the real model API. `npm run quality` must pass, coverage thresholds
  included.
- **Verify for real** where it matters (live data, a real ride) and say what
  was and was not verified.

## 5. Docs

Run `npm run docs:reference` after changing a command, a tool, a prompt or a
setting: the reference page is generated from the code, and CI fails when it
is out of date. The guide (`docs/guide/`): what the feature is for, how to use it in each mode
side by side, its limits; a new page for a new task, and a line in the sidebar
(`docs/guide/.vitepress/config.mts`). The README only when the overview changes
(what you get, how it is built). `docs/ENGINEERING.md` when the architecture,
a tool or a data source changes; its harness diagrams and their table (section
"The harness") when the planner loop, the MCP flow, a hard rule or the checks
change.
`AGENTS.md` or `CONTRIBUTING.md` when the way of working changes. `ROADMAP.md`:
remove what is done, add what was learnt.

## 6. Showcase

A feature a rider would notice earns its place on the site (`site/index.html`)
and, when it changes the overview, in the diagram (`docs/how-it-works.svg`,
re-rendered to PNG). Same design language, real examples, no invented figures.

## 7. Pull request

Conventional Commits, one concern per commit, in the order of this path
(`docs(adr)`, `docs(spec)`, `feat`, `test`, `docs`). The PR title is a
Conventional Commit too: it becomes the commit on `main`. The template's
checklist mirrors this document. The maintainer reviews and merges.

## 8. Release

Nothing to do by hand. release-please turns `feat` and `fix` commits on `main`
into a release pull request with the version and the changelog; merging it
tags the release and publishes the notes.
