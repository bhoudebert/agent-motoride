# Contributing

## What helps most

agentMotoride is open source (MIT) and stands on open data. Small
contributions make the biggest difference, roughly in this order:

1. **Speed defaults for your country.** Where OpenStreetMap has no limit on a
   road, the planner uses the country's legal default (`RURAL_DEFAULT_KMH` in
   `src/tools/trip.ts`, 25 countries and regions today). A missing or wrong
   one skews riding times and the open-road share. Add it with its source
   (the highway code); a "Country rules" issue is enough if you do not code.
2. **Fixes in OpenStreetMap.** A missing speed limit, a camera not mapped,
   wrong opening hours: fix it at [openstreetmap.org](https://www.openstreetmap.org).
   Every plan, and every other app on OpenStreetMap, gets better.
3. **An eval case.** A rider request the agent gets wrong, with what a right
   answer must do (`evals/cases.ts`, graded by code). Recording a case costs
   API money, so the maintainer records it; the case itself is the
   contribution ("Eval case" issue).
4. **A bug report with its trace.** `npm run rides -- runs` and `trace <id>`
   show what a session did; that is what makes a bug fixable.
5. **A data source**: another traffic provider, a map background for the ride
   picture, a region's open data. See `ROADMAP.md`.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Setup

```bash
nvm use                 # Node 24, from .nvmrc
npm install             # also installs the git hooks (simple-git-hooks)
cp .env.example .env
npm run check           # environment and data services
```

## Workflow

The path every feature follows, from idea to release, is described in
`docs/EVOLVING.md`. In short:

1. Branch from `main`: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
2. Behaviour change: update the spec first, `openspec/specs/<capability>/spec.md`
   (requirements with scenarios). New capability: new folder plus a line in
   `openspec/README.md`.
3. Architectural choice (new dependency, data store, mode, model default,
   cross-cutting rule): add a record in `docs/adr/` from `template.md`.
4. Code with tests. Deterministic parts get unit tests under `test/`; the
   planner loop is tested against the fake services in `test/helpers/`. Never
   let a test reach the real model API.
5. `npm run quality` (typecheck, lint, format check, tests with coverage thresholds) must pass. The pre-commit hook
   formats and lints staged files; the commit-msg hook enforces Conventional
   Commits.
6. Open a pull request with the template filled in: what was verified, what
   was not. The **PR title follows the commit convention too**: squash merges
   turn it into the commit on `main`, which release automation reads. CI runs
   typecheck, lint, format check, tests, commitlint and the title check. The
   maintainer reviews and merges.

## Commits

Conventional Commits, enforced by the commit-msg hook and in CI:

```
<type>(<scope>): <subject>

<body: what and why, wrapped at 120 columns, optional>

<footer: BREAKING CHANGE: ..., Refs #12, optional>
```

### Types

| Type       | Use for                                                | Release effect                 |
| ---------- | ------------------------------------------------------ | ------------------------------ |
| `feat`     | A capability the rider or an agent did not have before | minor version                  |
| `fix`      | Wrong behaviour corrected                              | patch version                  |
| `perf`     | Same behaviour, faster or cheaper                      | patch version                  |
| `refactor` | Code change with no behaviour change                   | none                           |
| `docs`     | Guide, README, specs, roadmap, comments                | none (listed in the changelog) |
| `test`     | Tests only                                             | none                           |
| `build`    | Dependencies, tooling, scripts, package.json           | none (listed in the changelog) |
| `ci`       | GitHub Actions, Dependabot, release automation         | none                           |
| `chore`    | Housekeeping that fits nowhere else                    | none                           |
| `style`    | Formatting, no logic change                            | none                           |
| `revert`   | Reverts a previous commit; subject names it            | depends on what is reverted    |

A breaking change adds `!` after the scope, `feat(mcp)!: ...`, and a
`BREAKING CHANGE:` footer explaining the migration. Before 1.0 it bumps the
minor version, after 1.0 the major.

### Scopes

Lower-case, kebab-case, the area touched. Common ones:

`planner`, `scouts`, `tools`, `routing`, `roads`, `weather`, `stops`,
`cameras`, `rides` (the library), `export` (GPX, Markdown), `share`, `cli`,
`mcp`, `codex`, `trace`, `runs`, `store`, `profile`, `deps`, `release`.

A scope is optional for changes that span the project (`docs: ...`,
`build: ...`).

### Subject and body

- Imperative, present tense: "add", "fix", "remove", not "added" or "adds".
- No trailing period, at most 100 characters for the whole header.
- Body when the why is not obvious from the diff: what changed, why, what was
  verified. Reference issues in the footer: `Refs #12`, `Closes #12`.
- One concern per commit. A PR with a feature, its tests and its docs is three
  commits, or one `feat` commit when they are inseparable.

### Examples

```
feat(stops): prefer places open at arrival
fix(mcp): route ride requests to the tools, not the shell
perf(roads): chunk Overpass queries along the route
refactor(tools): share tool definitions between the runner and the MCP server
docs(codex): remote connections from the ChatGPT app
test(maps): split links at a planned stop
build(deps): TypeScript 7 native compiler next to the TypeScript 6 API
ci: format check in the quality job
chore: remove scratch exports
revert: "feat(stops): prefer places open at arrival"
```

No attribution trailers or generated-by footers in commits or pull requests.

## Licence of contributions

Contributions are accepted under the project's MIT licence; by opening a pull
request you agree to it. Data contributions (speed defaults) cite their
source; never paste data from a source whose licence does not allow it.

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
