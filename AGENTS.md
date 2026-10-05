# Working in this repository

Read this before changing anything. It applies to people and to coding agents
(Codex, Claude Code, others) alike.

## What this is

agentMotoride: an agentic motorcycle ride planner. `README.md` explains the product
and the two modes (API and MCP). `openspec/project.md` holds the conventions
and the domain vocabulary; `openspec/specs/<capability>/spec.md` describe the
behaviour as requirements with scenarios.

## Rules

1. **Branch, then pull request.** Never commit to `main`. Branch names:
   `feat/...`, `fix/...`, `docs/...`, `build/...`, `ci/...`, `chore/...`.
2. **Conventional Commits, strictly.** `<type>(<scope>): <subject>` with the
   types `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
   `chore`, `style`, `revert`; kebab-case scope; imperative subject; one
   concern per commit. Full rules and examples: `CONTRIBUTING.md`, section
   "Commits". The commit-msg hook and CI reject anything else.
3. **Spec first when behaviour changes.** Update or add the requirement in
   `openspec/specs/...` in the same PR, before or with the code. A significant
   architectural choice gets a decision record in `docs/adr/` (read the
   existing ones before changing something they cover).
4. **Tests with the code.** Deterministic logic gets unit tests in `test/`;
   the planner loop is tested against `test/helpers/fakeServices.ts`. Tests
   never reach the real model API or spend money.
5. **Quality gate before pushing:** `npm run quality` (typecheck, lint, format
   check, tests) must pass. `npm run lint:fix` and `npm run format` fix most
   findings.
6. **Docs with the change.** README when usage changes; `ROADMAP.md` when an
   idea is done or added.
7. **Pull request** with the template: summary, spec touched, what was
   verified, what was not. The maintainer reviews and merges.
8. **No attribution trailers** or generated-by footers in commits, PR
   descriptions or comments.

## Code conventions

- Tools are plain async functions in `src/tools/`; schemas and descriptions in
  `src/tools/index.ts`, shared by the API runner and the MCP server.
- Rider rules (no motorways, no duplicate rides, valid route ids) are enforced
  in code, never left to the model.
- The MCP server writes only protocol to stdout; logs go to stderr.
- Public map services: serialise requests, chunk long queries, cache results,
  surface failures.
- TypeScript 7 is the compiler (`npm run typecheck`); the `typescript` package
  is the TypeScript 6 API alias for tooling. Do not "fix" that.

## Useful commands

```
npm run check        # environment and data services
npm run quality      # the gate
npm test             # unit tests only
npm run smoke        # live tools, no model
npm run mcp:smoke    # MCP server over stdio, no model
npm run rides -- runs | trace <id>   # what a planning session did
```
