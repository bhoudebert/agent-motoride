# 0058. Spec drift is checked by code first and a local model second

- Status: accepted
- Date: 2026-11-03

## Context

ADR 0044 made CI ask for a change under `openspec/` or `docs/` with any change under `src/`. That proves a file was touched,
not that the spec says what the code does: any edit to the guide satisfied it, and a threshold could change in the code while the
spec kept the old value. Review catches some of it. A model could read a diff against the requirements, but a model is wrong
sometimes, may be absent (no key, no budget, no network), and must not decide what merges. This is an open source project: a
check that needs a paid API or a secret cannot run on pull requests from forks.

## Decision

- **Deterministic checks decide.** `npm run spec:review` validates the specs, requires a spec change (or a proposal's, or a
  stated reason) with a change to `src/`, and checks that cited records and spec paths exist. A change to `docs/` is no
  longer accepted as proof. Pull requests run these checks, on a standard runner, with no model and no secret.
- **A local model advises.** With `--provider ollama` (or `openai`, for LiteLLM and other OpenAI-compatible servers) the command asks a model on the developer's machine for contradictions
  between a requirement, a record and the diff. Every finding must cite a spec file and a code file with quotes the program
  finds in the files; the others are dropped. Nothing is ever written to the specs or the code.
- **The hook blocks on evidence only.** `pre-push` blocks on a deterministic error or a verified high-severity finding of
  medium or high confidence. A review that did not run (no server, bad answer) is said so and does not block. CI never
  runs the model.
- **A small map from code to capability**, `openspec/code-map.json`, says which capability a source or test file belongs
  to. Without it a requirement cannot be found for a diff. A file the map does not know is a warning, and the check
  falls back to "any spec changed", the coarseness of ADR 0044.
- **One provider for now**, behind a small interface, so another local runtime can be added without changing the checks.

## Consequences

The "spec or docs" rule becomes "spec" (a refactor still takes `no-spec`, as a label or a `No-Spec:` line in a commit).
Some changes that only touched the guide now need the label or a spec line; that is the point. The map is a table to keep
up to date, which ADR 0044 refused: it is advisory except where a spec of the touched capability is what clears the error,
and the warning for unmapped files says when it has fallen behind. A model finding is a lead for the author, never a
verdict; a local model misses things and sometimes flags a conforming change. The scenarios in `evals/spec-review/` count true
and false positives and missed findings, so a model or a prompt is chosen on numbers. Git hooks run on the developer's machine
and `--no-verify` skips them: the pull-request check is what enforces the rule.

## Alternatives considered

A model in CI on a hosted API: a secret and a bill, and fork pull requests could not run it. A model on a self-hosted runner:
unsafe on a public repository. Letting the model decide what blocks, with no program check of its quotes: invented citations
would block pushes. Asking the model to rewrite the spec: the specs are the contract, a person writes them. No map, only
the changed spec files: cannot tell which requirement a diff concerns. A proposal-only workflow (`openspec/changes/`):
already available, and does not check the code.
