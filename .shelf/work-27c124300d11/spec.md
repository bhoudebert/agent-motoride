# Spec: OpenCode as a third MCP client

## Goal

agentMotoride already runs in the terminal and as an MCP server for Claude Code and Codex. I want a rider who uses OpenCode to connect it just as easily, and I want the guide, the README and the website to say that OpenCode works too, alongside Claude Code and Codex.

## Findings from the repository

Today "OpenCode" appears nowhere (README, site, guide, specs, scripts). Claude Code has a shipped `.mcp.json`; Codex has `npm run codex:register` and `codex/config.example.toml`. The server is a plain stdio MCP server (spec `mcp-server`, "Client portability": works with any MCP client), so no server change is implied; what is missing is the rider's way to connect it and the words saying so.

## Requirements

1. The repository SHALL give an OpenCode user a ready way to register the `ride` MCP server (a project file OpenCode reads, or a one-time command), so that starting OpenCode in the project, or after the one-time step, lists the `ride` tools.
2. The guide page for MCP clients SHALL cover OpenCode next to Claude Code and Codex: how to connect, what to say, and what differs (slash commands, subagent scouting, approval of tool calls), stating only what has been checked.
3. The README, the guide's home and menu, and the website SHALL name OpenCode wherever they name "Claude Code or Codex" as the MCP clients, including the comparison table row about what runs the agent, and the trademark note.
4. The MCP server's behaviour, tools, prompts and resources SHALL NOT change for this work.
5. `openspec/specs/mcp-server/spec.md` SHALL gain an OpenCode scenario under "Client portability", in the same form as the Codex and Claude Code ones.
6. The documentation check (generated reference, catalogue-driven pages) SHALL still pass after the renames and additions.

## Scenarios

- **WHEN** an OpenCode user follows the guide's OpenCode connection step **THEN** OpenCode lists the `ride` server and its tools, and "plan me a ride this Saturday" leads to `planningGuide` then the planning tools (requirement 1, 2).
- **WHEN** the OpenCode client has no subagent support for scouts (edge case) **THEN** the guide says the model explores the areas itself, as for Codex, and does not promise parallel scouts.
- **WHEN** the rider has not set a start point (edge case) **THEN** OpenCode gets the same "No start point yet" refusal as any client (requirement 4).
- **WHEN** a visitor opens the website **THEN** the lines that name Claude Code and Codex also name OpenCode (requirement 3).
- **WHEN** `npm run docs:reference` and the documentation check run **THEN** they pass with no stale page (requirement 6).

## Out of scope

- A server change for OpenCode, an OpenCode-specific prompt format or slash-command set.
- Running OpenCode in this repository's CI or adding a test for it.
- Other MCP clients (Cursor, Gemini CLI and so on).

## Conflicts with existing specs

- `mcp-server`, "Client portability": adds one scenario; the requirement text already says "any MCP client", so no contradiction.
- `mcp-server`, "Everything discoverable": the site's list and the guide must stay consistent with the catalogue; client names in `src/capabilities.ts` ("What to say in Claude Code or Codex") may change wording only.
- `multi-user-server` (mention "Claude Code or Codex" over HTTPS): wording only, if touched.
- ADR 0004 (two modes, shared tools) and ADR 0017 (elicitation and resources, not sampling): consistent; OpenCode is another MCP client of the same tools. None of the ADRs is contradicted.

## Assumptions

- "CLI and MCP" means the two modes in the README; OpenCode belongs to the MCP mode.
- The "extra pass" means: check first whether OpenCode already works and is mentioned (it is not mentioned), then add what is missing, including the website, which the request allows.
- OpenCode connects through its own MCP configuration (a project `opencode.json` with a local server entry, or its user config), so the spec asks for a way to register, not for a precise file format.
- The filename of the guide page (`claude-code-and-codex`) may be kept to avoid breaking links; the title and text change.

## Open questions

- I could not run OpenCode here, so its exact config format, its approval setting for tool calls, whether it shows MCP prompts as slash commands, and whether it runs subagents are unchecked. The guide must state only what the implementer verifies; if this cannot be verified, say "not checked" in the guide rather than claim it. The answers change the guide text and whether a register script (like Codex) or a shipped project file (like Claude Code) is the right form of requirement 1.
- Formatting: no linter was run on this file (Prettier is off for this folder by design; none other was tried).
