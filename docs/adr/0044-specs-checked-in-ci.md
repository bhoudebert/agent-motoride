# 0044. Check the specs in CI and require a spec or docs change with code

- Status: accepted
- Date: 2026-10-30

## Context

"Spec first" (`docs/EVOLVING.md`) and Conventional Commit PR titles (ADR 0011)
were rules people and agents were asked to follow, with nothing to catch a
miss. When `openspec validate` was first run, 16 of the 18 specs failed: about
60 requirements had no scenario. The PR title check ran, but was not required,
so a bad title could still be squash-merged onto `main`, where release-please
reads it.

## Decision

- The PR title check is a required status check on `main`.
- A `Specs` workflow validates every spec with `openspec validate --specs` on
  every pull request and on `main`. The tool comes from the flake's locked
  nixpkgs, the same version the dev shell provides (`nix/modules/openspec.nix`).
- The same workflow fails a pull request that changes `src/` without changing
  anything under `openspec/` or `docs/`, unless it carries the `no-spec` label.
  The label is for changes with no behaviour or usage change: a refactor, an
  internal fix, a dependency bump.
- Both checks are required on `main`. The missing scenarios were written once,
  from the code and tests, so the check starts green.

## Consequences

A spec that does not parse, or a requirement without a scenario, is caught
before review. Code that changes behaviour without a word in the spec or the
docs needs a deliberate label, visible in review. The check cannot tell
whether the spec change matches the code change; review still does that.
Strict mode (requirements under 500 characters) is not enforced: about 40
long requirements would have to be split first.

## Alternatives considered

Validating only the specs a pull request touches: no backfill, but old specs
stay broken until someone edits them. An advisory check: easy to ignore.
Mapping each source file to its capability: precise, but a table to maintain.
