# Design: OpenCode as a supported client

## Approach

No `src/` change. The server already speaks MCP over stdio to any client (`mcp-server`, "Client portability"; ADR 0004). Supporting OpenCode is one connection file, one drift test, and documentation. The documentation rule is applied by grep and classification over the whole guide, not by line numbers. No ADR: nothing here is expensive to reverse, and ADR 0004 already decides "two modes, shared tools".

## Changes to the spec's scope (round 1)

These widen or tighten `spec.md`; the implementer follows this document where they differ.

1. **Requirement 4 widens** from its file list to every `docs/guide/*.md` page, plus `README.md`, `site/index.html` and `docs/guide/.vitepress/config.mts`, with the same exceptions list and the classification below.
2. **Requirement 3 and requirement 5 are narrowed to what the repository controls.** The guide states what the server sends ("the tools carry the four MCP hints; a client can use them to approve lookups"; "the server asks the client to fetch `planningGuide` before planning"), not what OpenCode does with it. The `mcp-server` scenario no longer claims instructions or `planningGuide` behaviour in OpenCode; it says the `ride` server starts from `src/mcp.ts` and its tools are listed. That claim is still the one a reviewer confirms (see Verification). Done in `openspec/specs/mcp-server/spec.md`.
3. **New requirement: drift test** (below). It adds no requirement to a spec: it tests a repository file, not behaviour.

## Spec written

`openspec/specs/mcp-server/spec.md`, requirement "Client portability": scenario "OpenCode" added after "Codex CLI", requirement text unchanged. Written in this step. No other spec changes; `multi-user-server` and "Client scouting" stay as they are.

## Files touched

| File | Change |
|---|---|
| `opencode.json` (new, root) | `{ "mcp": { "ride": { "type": "local", "command": ["node", "--env-file-if-exists=.env", "src/mcp.ts"], "enabled": true } } }`, 2-space indent. No `$schema`. |
| `test/opencode-config.test.ts` (new) | Drift test, see below. |
| `docs/guide/getting-started.md`, `docs/guide/claude-code-and-codex.md` | Third code-group tab "OpenCode": the project file, and a user-level `~/.config/opencode/opencode.json` snippet with absolute paths for use from another folder. Short "OpenCode" section on the second page, limited to what the server sends plus a pointer to OpenCode's documentation for approvals, subagents, slash commands and attachments. Title and heading name OpenCode; file name and address unchanged. |
| Every other `docs/guide/*.md` | The grep rule below: tab label and prose. |
| `docs/guide/.vitepress/config.mts` | Menu text (line 38) and site description name OpenCode; `link` unchanged. |
| `scripts/reference.ts` | The generator source of `reference.md`: line 126 (heading "Claude Code and Codex (MCP server)", now "Claude Code, Codex and OpenCode (MCP server)"), and lines 174 and 178 (the "Everything" intro, "In Claude Code or Codex ... Claude Code or Codex"). Line 140 (slash commands) stays Claude-only. |
| `docs/guide/reference.md` | Regenerated with `npm run docs:reference`, never edited by hand. Spec said this was not needed: it is, because the heading text changes. The generated tool and prompt counts must not change; if the diff shows more than the heading and intro, stop and look. |
| `README.md`, `site/index.html` | The grep rule; "Model and effort" row becomes "The MCP client's own model"; trademark line gains OpenCode. |
| `NOTICE.md` | Line 36, the list of trademarks: add "OpenCode" (same reason as the README trademark line). |
| `openspec/specs/mcp-server/spec.md` | The scenario. |

`ROADMAP.md` is unchanged: it holds no OpenCode idea, and AGENTS.md rule 6 asks for it only when an idea is done or added. `openspec/code-map.json` is unchanged (no `src/` symbol).

## The grep rule (all files above)

For `Claude Code` and `Codex` across `README.md`, `site/index.html`, `docs/guide/**/*.md` (skip `node_modules`, `.vitepress/dist`), `docs/guide/.vitepress/config.mts`, `scripts/reference.ts`:

1. List every hit. Classify it as **in** (names the clients of MCP mode generally) or **out** (an exception).
2. Change only **in** hits, to "Claude Code, Codex or OpenCode" (order kept; "and" where the sentence says "and").
3. The code-group tab label `[Claude Code / Codex]` becomes `[Claude Code / Codex / OpenCode]` in all 26 occurrences in 11 pages (`getting-started`, `phone-and-gps`, `plan-a-ride`, `notes-and-review`, `library`, `stops-and-bike`, `settings`, `from-a-photo`, `import-a-route`, and any found by the grep in `everything`, `limits`, `sessions`, `self-hosting`). One label, identical everywhere, so VitePress tab sync (it syncs groups by label) stays consistent. A single replace over the folder, then the grep finds none of the old label.
4. After editing, re-grep and check that every remaining "Claude Code" or "Codex" is an **out** hit, and that `git diff` shows no hunk inside an exception.

### Exceptions (stay as they are), decided

- Phone pairing, remote control and multi-user HTTPS: pages `from-your-phone`, `chat-on-your-phone`, `several-riders`; README lines about them; `site/index.html` phone card; `src/oauth.ts` comment.
- Codex-only facts: `npm run codex:register`, `codex/config.example.toml`, the Codex tab and its approval line.
- Claude-Code-only facts: slash commands (`/mcp__ride__...`), `@` attachments and forms, subagent scouts (README and the scouts table), `scripts/reference.ts` line 140.
- Contributor-facing pages and notes, left alone because they describe how the code works and what has been tested, not who is supported: `docs/ENGINEERING.md` (lines 86, 690, 726, 767 are Claude-only facts; 125 and 794 list clients, so they gain "OpenCode" like the guide), `openspec/project.md` (line 6 "a MCP client such as Claude Code" is an example, not a list, and stays), `ROADMAP.md`, `CONTRIBUTING.md`, `CHANGELOG.md` (history).
- `site/index.html` 496 and 564, `README.md` 150 and 158: the implementer classifies them by the rule; the rule decides, not these numbers. When a hit is a list of clients it is **in**; when it names one client for a feature only that client has, it is **out**. The pull request body lists every **out** hit that looks like a client list, with a reason, so a reviewer can disagree.

## Drift test

`test/opencode-config.test.ts`: reads `.mcp.json` and `opencode.json` and asserts `opencode.mcp.ride.command` deep-equals `[mcp.mcpServers.ride.command, ...mcp.mcpServers.ride.args]`, and that `type` is `"local"` and `enabled` is `true`. Plain `node:test`, no network, no model. It stops the two files drifting apart; it cannot prove OpenCode accepts the keys.

## Interfaces and data shapes

OpenCode config shape: `mcp.<name>` with `type: "local"`, `command: string[]`, `enabled: boolean`. No environment is set in the file; `--env-file-if-exists=.env` loads it, as in `.mcp.json`. The user-level snippet needs absolute paths for `src/mcp.ts` and for the `.env` file if used; the relative form works only from the project folder.

## Errors

Nothing at runtime. The risk is a wrong key, since OpenCode could not be run here. A wrong key makes the file silently do nothing, so the manual check is a named item, not a hope: the pull request template's "what was not verified" states "Not run in OpenCode: `opencode` started in the project folder lists the ride tools; the user-level snippet and its path `~/.config/opencode/opencode.json` are unchecked". The reviewer ticks it before merging; a wrong key is a one-file fix plus the guide snippet.

## `.prettierignore`

The `.shelf/` entry (commit 3072561) is already on the branch. It is Shelf's own housekeeping and the pipeline owns it; this change neither reverts nor depends on it. Spec and design earlier said it "stays out of the PR": that claim is withdrawn, because nothing here removes it. If the maintainer wants it out, a revert commit on the branch does it. Either way `npm run quality` is safe: Prettier skips `.shelf/` with the entry, and `opencode.json` is formatted by `npm run format`. The implementer runs `npm run quality` and reports the result.

## Verification

- `openspec validate --all` parses the scenario.
- `npm run quality` (includes the drift test and the format check of README, guide, site, `opencode.json`).
- `npm run spec:review -- --base origin/main --head HEAD` and `-- --audit`.
- `npm run docs:reference` leaves `reference.md` changed only in the heading and intro.
- VitePress build of the guide (the repository's docs build script) for tab rendering and dead links.
- Reviewer, manual: `opencode` in the project folder lists the ride tools.

## Alternatives rejected

- **A `npm run opencode:register` script** like `codex:register`: Codex reads no project file; OpenCode does. Extra code, out of scope.
- **Rename the guide page**: breaks links; only title and menu text change.
- **A neutral tab label** ("MCP client"): loses the signal of what the tab is for; the explicit three-name label is searchable and syncs the same way.
- **Document OpenCode behaviours** from memory: unverified; the guide states what the server sends and defers to OpenCode's documentation.
- **A proposal in `openspec/changes/`**: single PR (AGENTS.md rule 3).

## Assumptions

- Spec assumptions hold (no `src/` change; guide address kept; order "Claude Code, Codex or OpenCode").
- The user-level config path `~/.config/opencode/opencode.json` and the project keys are from memory, checked by the reviewer.
- `$schema` is left out of `opencode.json`.
- The tab label becomes `[Claude Code / Codex / OpenCode]` everywhere.
- `ENGINEERING.md` lines that list clients (125, 794) gain OpenCode; `openspec/project.md` stays; `NOTICE.md` gains the trademark.
- The `.shelf/` entry in `.prettierignore` is accepted as part of the branch.
- No ADR is written, since the decision is not lasting.

## Formatting check

No markdown linter available for this file; Prettier is off for the folder.
