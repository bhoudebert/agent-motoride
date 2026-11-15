# OpenCode as a supported client

Round 1 changes: requirement 1 is now unconditional (project `opencode.json`, exact keys, one reviewer check); requirement 3 holds only facts true from this repository; the `mcp-server` scenario is written out; requirement 4 has a rule and a closed list with exclusions; requirement 6 gives the README wording; `.prettierignore` and `docs:reference` are answered.

## Goal

Today the README, the guide and the website say the app works in the terminal and in Claude Code or Codex. I want a rider who uses OpenCode to be able to connect agentMotoride to it, plan a ride in plain words, and find that written down, the same way as for Claude Code and Codex, including on the website.

## Assumptions

- The server already works with any MCP client over stdio (`mcp-server`, "Client portability"). Supporting OpenCode is a ready connection and documentation, not new server behaviour. No `src/` change.
- The connection is a project file `opencode.json` at the repository root, next to `.mcp.json`. Its keys are named in requirement 1. I could not run OpenCode here; the merge reviewer confirms them (see Open questions). A wrong key is a fix to that file; no requirement changes.
- The guide page keeps its address (`/claude-code-and-codex`) so no link breaks. Its file is not renamed; its title and menu text change.
- OpenCode is listed after Codex ("Claude Code, Codex or OpenCode"). Wording true only of Claude Code stays Claude-only.
- The `.shelf/` entry added to `.prettierignore` on this branch is Shelf housekeeping, not part of this request; it stays out of the pull request.
- No command, tool or setting changes, so `npm run docs:reference` is not needed.

## Requirements

1. The repository SHALL ship a root `opencode.json` that declares the server `mcp.ride` with `type` `"local"`, `command` the array `["node", "--env-file-if-exists=.env", "src/mcp.ts"]` (the same command as `.mcp.json`) and `enabled` `true`, so that `opencode` started in the project folder lists the ride tools.
2. The guide SHALL show how to connect OpenCode as a third tab beside Claude Code and Codex in the connect code group of `getting-started.md` and of `claude-code-and-codex.md`, with, for use from another folder, a user-level config using absolute paths.
3. The guide page `claude-code-and-codex.md` SHALL gain one short "OpenCode" section stating only: the server speaks MCP over stdio; the tools carry the four MCP hints, which a client may use to approve lookups without asking; the model fetches the guidance with `planningGuide` before planning; and, for approvals, scouting by subagents and slash commands or attachments, "depends on your client: check OpenCode's documentation". It SHALL NOT state OpenCode behaviour for slash commands, attachments, dialogs, approvals or subagents.
4. Every mention of Claude Code and Codex as the clients of MCP mode in the README, `site/index.html`, `docs/guide/getting-started.md`, `docs/guide/index.md`, `docs/guide/.vitepress/config.mts` (menu text and site description) and `docs/guide/claude-code-and-codex.md` (title and heading) SHALL name OpenCode too, except the following, which stay as they are:
   - phone pairing, remote control and multi-user HTTPS: `README.md` lines 62 and 73, `site/index.html` line 528, and the pages `from-your-phone`, `chat-on-your-phone` and `several-riders`;
   - Codex-only facts: `npm run codex:register`, `codex/config.example.toml`, the Codex tab and its approval line;
   - Claude-Code-only facts: slash commands such as `/mcp__ride__plan-ride` (the website card's code line, `README.md` line 53's shortcut clause, `site/index.html` line 444's slash commands, `getting-started.md` lines 87 to 89), the `@` attachments and forms section, and the subagent-scouts claims (`README.md` lines 52 and 197, `claude-code-and-codex.md` scouts table);
   - the trademark line (`README.md` 210) which gains "OpenCode" among the product names.

   The places to update, as of this checkout, are `README.md` 32, 51, 52 (the "Your Claude Code or Codex plan" part only), 53 (the "Plain words in…" part only), 57 to 59, 111, 128 to 129, 132, 158, 197 (first clause), 223; `site/index.html` 351, 365, 444 (the "From Claude Code or Codex in plain words" part only), 522 (heading), 592; `getting-started.md` 8, 10, 32, 66, 80, 87 (first clause); `index.md` 7; `config.mts` 9 and 38. Line numbers may drift; the rule above decides.
5. The `mcp-server` spec, requirement "Client portability", SHALL gain the scenario below and its requirement text SHALL stay unchanged.
6. The README comparison row "Model and effort" SHALL read "The MCP client's own model" and SHALL NOT name which provider's models any client uses; it claims nothing about OpenCode's providers.

## Scenarios

### Requirement 1

- **WHEN** the rider runs `opencode` in the project folder
- **THEN** the `ride` server starts from `src/mcp.ts` and its tools are listed
- **WHEN** OpenCode is started from another folder
- **THEN** the guide's user-level snippet with absolute paths is what applies, because the relative `src/mcp.ts` would not be found

### Requirement 2

- **WHEN** a reader opens the connect code group on either page
- **THEN** there is an OpenCode tab beside Claude Code and Codex

### Requirement 3

- **WHEN** a reader looks for what OpenCode does about approvals or subagents
- **THEN** the page sends them to OpenCode's documentation and claims nothing

### Requirement 4

- **WHEN** a reader opens the README, the website cards or the guide start pages
- **THEN** each place that lists the MCP clients lists OpenCode
- **WHEN** the same reader opens a phone, remote-control or `codex:register` passage
- **THEN** it is unchanged

### Requirement 5: scenario to add under "Client portability"

```markdown
#### Scenario: OpenCode

- **WHEN** OpenCode is started in the project folder, where `opencode.json` declares the `ride` server as a local MCP server (or the server is declared in the user's OpenCode config), and the rider asks for a ride in plain words
- **THEN** the model receives the server instructions, fetches the guidance with `planningGuide`, and plans with the tools
```

Nothing is claimed about approval: the Codex scenario names its approval mode because Codex needs one; for OpenCode it was not checked.

- **WHEN** `openspec validate --all` runs
- **THEN** the scenario parses

### Requirement 6

- **WHEN** a reader reads the README table
- **THEN** the "Model and effort" row ends with "The MCP client's own model" and names no provider

## Out of scope

- Any change in `src/`, a new npm script such as `opencode:register`, or new server tools.
- Phone pairing, remote control and multi-user HTTPS for OpenCode.
- OpenCode's model providers or cost.
- Renaming the guide file or changing its address.

## Conflicts with existing specs

- `mcp-server`, "Client portability": touched by one added scenario; the requirement text is unchanged, and it already says any MCP client over stdio.
- `mcp-server`, "Client scouting when API scouts are off": not changed; its brief already says "when the client can", so it holds for OpenCode.
- `multi-user-server` (purpose names "Claude Code or Codex"): not changed; OpenCode over HTTPS was not checked.
- ADR 0004 (two modes, shared tools) and ADR 0017 (elicitation and resources, not sampling): no contradiction; OpenCode is one more MCP client of the second mode.
- AGENTS.md rule 3: no `src/` change, so CI does not force a spec; the `mcp-server` scenario is added because the supported-client list is what a rider reads.

## Open questions

- I could not run OpenCode or read its documentation. The keys in requirement 1 (`mcp.ride`, `type`, `command` as an array, `enabled`) and project-level reading of `opencode.json` are from memory. Before merging, the reviewer runs `opencode` in the project folder and confirms the ride tools are listed. If a key differs, the file is corrected; the requirement does not change. The user-level snippet in requirement 2 is confirmed the same way.
- Whether OpenCode supports prompts as slash commands, `@` resources and elicitation forms is not known; the guide says nothing about it (requirement 3). This does not change the design.

Formatting: no markdown linter is available for this file; Prettier is off for the folder.
