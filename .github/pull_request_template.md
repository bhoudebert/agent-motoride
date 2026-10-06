<!-- Title: Conventional Commits, e.g. "feat(stops): prefer places open at arrival". The title becomes the commit on main. -->
<!-- The path every change follows: docs/EVOLVING.md -->

## Summary

<!-- What changes and why, in a few lines. -->

## Decision and spec

<!-- ADR added or "none needed" (docs/adr/). Spec requirement added or changed (openspec/specs/...), or "no behaviour change". -->

## Verified

<!-- What was run: npm run quality, smoke tests, a real planning run (trace id), a real device. State what was NOT verified. -->

## Checklist (docs/EVOLVING.md)

- [ ] ADR when the shape of the system changes
- [ ] Spec updated first when behaviour changes
- [ ] Reachable in every mode (MCP tool/prompt, API planner, CLI) or the spec says why not
- [ ] Tests with the code; `npm run quality` passes
- [ ] Guide updated (`docs/guide/`); README if the overview changed; roadmap updated
- [ ] Site and diagram updated when a rider would notice the feature
- [ ] Commits and PR title follow Conventional Commits
