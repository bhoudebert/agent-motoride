# Spec: OpenCode alongside Claude Code and Codex

## Goal

Today the README, the guide and the website say agentMotoride works in the terminal and in "Claude Code or Codex". I want a rider who uses OpenCode to see that it works for them too, to know how to connect it, and to find OpenCode named wherever Claude Code and Codex are named.

What the repository shows today: OpenCode is not mentioned anywhere (no file, no script, no page). Claude Code is connected by the project's `.mcp.json`; Codex by `npm run codex:register` and `codex/config.example.toml`. The server itself is a plain MCP server over stdio, so the work is a connection path and the wording, not a change to the tools.

## Requirements

1. The guide SHALL tell an OpenCode rider how to connect the `ride` MCP server (the page "Claude Code and Codex" gains an OpenCode tab, and is renamed to include OpenCode, its link and menu entry updated with it).
2. The connection steps SHALL leave the server running with the same command as for the other clients (`node --env-file-if-exists=<.env> <src/mcp.ts>`, absolute paths when the client may start from any directory), and SHALL say how a rider avoids a confirmation on every tool call, if OpenCode has such a setting.
3. The repository SHALL ship an example OpenCode configuration for the server, next to `codex/config.example.toml`, that a rider can copy.
4. The README, the guide pages, and the website (`site/index.html`) SHALL name OpenCode wherever they name "Claude Code or Codex" as the clients that use the tools, including the comparison table, the "From your phone" box only where it is true for OpenCode (see open questions).
5. The pages SHALL NOT claim for OpenCode what is only true of Claude Code (the `/mcp__ride__…` slash commands, `@ride:` attachments, forms, Claude subagents as scouts) unless that has been checked in OpenCode.
6. The MCP server's behaviour SHALL NOT change: the same tools, prompts, resources and instructions are served to every client.

## Scenarios

### Requirement 1 and 2

- **WHEN** a rider opens the guide page on connecting clients and picks the OpenCode tab
- **THEN** they find the config to add, with absolute paths, and the line for approval of tool calls
- **EDGE: WHEN** they follow only the Claude Code or Codex tab **THEN** nothing there has changed in meaning

### Requirement 3

- **WHEN** a rider copies the example file into their OpenCode config and starts OpenCode
- **THEN** the `ride` server is listed as connected and "show roadbook 7" reaches the tools
- **EDGE: WHEN** `.env` does not exist **THEN** the server still starts (`--env-file-if-exists`)

### Requirement 4

- **WHEN** one searches the README, the guide and `site/index.html` for "Codex"
- **THEN** every place that lists the clients also lists OpenCode
- **EDGE:** mentions of Codex that are specific to it (`codex:register`, `~/.codex/config.toml`, trademark notice) stay Codex-only; the trademark list in `README.md` and `NOTICE.md` also names OpenCode

### Requirement 5

- **WHEN** a page describes slash commands, forms or attachments
- **THEN** it says they are for Claude Code, and says plain words work in OpenCode, unless checked otherwise

### Requirement 6

- **WHEN** the existing MCP end-to-end tests run
- **THEN** they pass unchanged

## Out of scope

- A `npm run opencode:register` script (the Codex one exists because Codex needs a CLI command; add one only if the design finds OpenCode needs it).
- Changes to tools, prompts, the planner, or the API/terminal mode.
- Remote or phone use of OpenCode, unless it is verified.
- Changing the page order or the site design beyond the wording.

## Conflicts with existing specs

- `openspec/specs/mcp-server/spec.md`, "Client portability" (any MCP client over stdio; Codex CLI, Claude Code, plain-words scenarios): this work adds a scenario "OpenCode" there. No requirement text is contradicted. It stays consistent with "the same planning in plain words in every client".
- `openspec/specs/multi-user-server/spec.md` (purpose line: "from Claude Code or Codex"): wording only; the requirement is not changed, and OpenCode is added only if remote HTTPS use is verified.
- `openspec/specs/mcp-server/spec.md`, "Client scouting when API scouts are off": OpenCode is not said to run subagents; the existing "otherwise explore the areas itself" covers it.
- ADR 0004 (two modes, shared tools) and ADR 0017 (elicitation and resources, not sampling): not touched; no new mode.

None other.

## Open questions

- I could not check OpenCode's facts here (no network, not installed): its MCP config file name and keys, whether a project-level config is read, whether it has a setting to skip per-call approval, whether it runs subagents, and whether it can accept a remote connection. The design must verify them against OpenCode's own documentation before the guide states them; if one is false the matching sentence is left out. If OpenCode reads no project-level file, the example must say where to copy it, as the Codex one does.
- Does the maintainer want a `register` script for OpenCode? It would change the design (a script, a test, the commands reference) and is left out until asked.
- Markdown lint for this file: none was run; the repository's Prettier is switched off for this folder and no other markdown linter is installed.
