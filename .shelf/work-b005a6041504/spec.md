# OpenCode as a supported client

## Goal

Today the README, the guide and the website say the app works in the terminal and in Claude Code or Codex. I want a rider who uses OpenCode to be able to connect agentMotoride to it, plan a ride in plain words, and find that written down, the same way as for Claude Code and Codex. If a pass over the repository shows something is missing, add it, including the website.

## Assumptions

- The server already works with any MCP client over stdio (`mcp-server`, "Client portability"). So "supporting OpenCode" means a documented, ready-to-use connection, not new server behaviour. No `src/` change is planned.
- The connection is a project file `opencode.json` at the repository root (like the shipped `.mcp.json` for Claude Code), so starting `opencode` in the project folder works with no command. This is from my knowledge of OpenCode's config and I could not run OpenCode here (see Open questions).
- The guide page keeps its address (`/claude-code-and-codex`) so no link breaks; only its title, menu text and wording change. Its file is not renamed.
- OpenCode is listed after Codex wherever the two are listed ("Claude Code, Codex or OpenCode"). Wording that is true only of Claude Code (slash commands, `@` attachments, form dialogs) is not claimed for OpenCode.

## Requirements

1. The repository SHALL ship an `opencode.json` that registers the `ride` MCP server so that `opencode` started in the project folder offers the ride tools, with the same command as `.mcp.json`.
2. The guide's connect section (getting started and the Claude Code and Codex page) SHALL show how to connect OpenCode next to Claude Code and Codex.
3. The guide page SHALL state what differs for OpenCode: how tool calls are approved, which of slash commands, attachments and dialogs apply, and who scouts when `RIDE_SCOUTS=0`. It SHALL NOT claim a behaviour of OpenCode that was not checked.
4. The README, the guide index and landing text, the "Claude Code or Codex" card on the website (`site/index.html`), and the guide's menu SHALL name OpenCode wherever they name Claude Code and Codex as the clients of MCP mode.
5. The `mcp-server` spec, requirement "Client portability", SHALL gain a scenario for OpenCode.
6. The rider-facing description of the model in MCP mode ("the MCP client's own model") SHALL stay true for OpenCode: the README comparison table SHALL not say the model is Claude or OpenAI only.

## Scenarios

### Requirement 1

- **WHEN** the rider runs `opencode` in the project folder
- **THEN** the `ride` server starts from `src/mcp.ts` and its tools are listed
- **WHEN** the rider moves the project or runs OpenCode from another folder
- **THEN** the guide says to use absolute paths in a user-level OpenCode config, as it does for Claude Code and Codex, because a relative `src/mcp.ts` would not be found

### Requirement 2

- **WHEN** a reader opens the "Connect" code group
- **THEN** there is an OpenCode tab beside Claude Code and Codex

### Requirement 3

- **WHEN** the rider asks "plan me a ride this Saturday, no rain" in OpenCode
- **THEN** the model fetches the guidance with `planningGuide` and plans with the tools (the existing plain-words behaviour)
- **WHEN** OpenCode cannot run subagents, or the page does not know
- **THEN** the page says the model explores the areas itself, as it does for Codex

### Requirement 4

- **WHEN** a reader searches the README, guide and site for "Codex"
- **THEN** every place that lists the MCP clients also lists OpenCode (places about Codex alone, such as `codex:register` or ChatGPT phone pairing, are not changed)

### Requirement 5

- **WHEN** `openspec validate --all` runs
- **THEN** the OpenCode scenario parses and the requirement still reads "any MCP client over stdio"

## Out of scope

- Any code change in `src/`, a new npm script such as `opencode:register`, or new server tools.
- Phone pairing and remote control for OpenCode (`from-your-phone`, `chat-on-your-phone`): not claimed, left as they are.
- OpenCode's own model providers or cost; the guide only says the client's model plans.
- Renaming the guide file or changing its address.

## Conflicts with existing specs

- `mcp-server`, "Client portability": touched (a scenario is added). It stays consistent: the requirement already says any MCP client over stdio, and the new scenario adds no obligation on the server.
- `mcp-server`, "Client scouting when API scouts are off": not changed. The scout brief already says "when the client can" start subagents, which covers OpenCode either way.
- `multi-user-server` names "Claude Code or Codex" in its purpose. Not changed here: OpenCode over HTTPS with a rider token was not checked, and I do not claim it.
- ADR 0004 (two modes, shared tools) and ADR 0017 (elicitation and resources, not sampling): no contradiction. OpenCode is one more MCP client in the second mode.
- AGENTS.md rule 3: the change touches no `src/`, so no spec is forced by CI; the `mcp-server` scenario is added because the supported-client list is behaviour a rider reads.

## Open questions

- I could not run OpenCode or read its documentation here. The exact `opencode.json` keys (`mcp`, `type: "local"`, `command` as an array, environment), whether OpenCode reads a project-level file, its tool-approval setting, and whether it runs subagents are from memory. The design answers: verify them against a real OpenCode install before merging. If the project file is not read, requirement 1 becomes a user-level config instructions only, and requirement 1's first scenario changes.
- Does OpenCode support the MCP features the guide leans on (prompts as commands, resources with `@`, elicitation forms)? Unknown. The page says only what was checked. This does not change the design.
- Should `multi-user-server` and the phone pages also name OpenCode? Left out until someone tests it.

Formatting: no markdown linter run on this file; Prettier is switched off for the folder.
