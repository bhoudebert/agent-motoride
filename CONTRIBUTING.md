# Contributing

## Setup

```bash
nvm use                 # Node 24, from .nvmrc
npm install             # also installs the git hooks (simple-git-hooks)
cp .env.example .env
npm run check           # environment and data services
```

## Workflow

1. Branch from `main`: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
2. Behaviour change: update the spec first, `openspec/specs/<capability>/spec.md`
   (requirements with scenarios). New capability: new folder plus a line in
   `openspec/README.md`.
3. Code with tests. Deterministic parts get unit tests under `test/`; the
   planner loop is tested against the fake services in `test/helpers/`. Never
   let a test reach the real model API.
4. `npm run quality` (typecheck, lint, format check, tests) must pass. The pre-commit hook
   formats and lints staged files; the commit-msg hook enforces Conventional
   Commits.
5. Open a pull request with the template filled in: what was verified, what
   was not. CI runs typecheck, lint, tests and commitlint. The maintainer
   reviews and merges.

## Commits

Conventional Commits, one concern per commit:

```
feat(stops): prefer places open at arrival
fix(mcp): route ride requests to the tools, not the shell
docs: Codex remote connections
test(maps): split links at a planned stop
build: ESLint and Prettier
```

`feat` and `fix` drive the version and the changelog through release
automation; `docs`, `test`, `build`, `chore`, `refactor`, `style` do not bump
the version.

No attribution trailers or generated-by footers in commits or pull requests.

## Releases

Release automation (release-please) opens and maintains a release pull request
on `main` with the changelog and version bump. Merging it tags the release and
publishes GitHub release notes. Nothing is published to npm.

## Code conventions

- Tools are plain async functions in `src/tools/`; schemas and descriptions
  live in `src/tools/index.ts` and are shared by the API runner and the MCP
  server.
- Rider rules are enforced in code, not left to the model.
- The MCP server logs to stderr only; stdout carries the protocol.
- Public map services: serialise, chunk, cache, and surface failures.
- Lint: ESLint with typescript-eslint, `eslint.config.js`. Format: Prettier,
  `.prettierrc.json`. Both pure JavaScript, no platform-specific binaries.
- TypeScript, two packages on purpose: `@typescript/native` is TypeScript 7,
  the native compiler behind `tsc` and `npm run typecheck`; `typescript` is an
  alias of `@typescript/typescript6`, the last version with a JavaScript API,
  which typescript-eslint and editors import. This is the layout the
  TypeScript 7 announcement recommends. Both are bumped by Dependabot
  independently.
