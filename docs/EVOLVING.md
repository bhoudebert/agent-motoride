# How agentMotoride evolves

Every feature goes through the same path, whoever builds it, a person or a
coding agent. The path exists so that each change is designed before it is
coded, specified before it is tested, and explained before it is released.

```
idea ─▶ decision ─▶ spec ─▶ code + tests ─▶ docs ─▶ showcase ─▶ PR ─▶ release
        (ADR)      (openspec)  (all modes)   (README)  (site)    (review) (automatic)
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
written first and reviewed with the code in the same pull request.

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
- **Rules in code.** Anything that must always hold is enforced in the tool or
  the store, never only in a prompt.
- **Tests with the code.** Deterministic logic gets unit tests in `test/`;
  the planner loop runs against `test/helpers/fakeServices.ts`. Tests never
  reach the real model API. `npm run quality` must pass, coverage thresholds
  included.
- **Verify for real** where it matters (live data, a real ride) and say what
  was and was not verified.

## 5. Docs

README: what the feature is for, how to use it in each mode, its limits.
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
