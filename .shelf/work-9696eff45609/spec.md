# Spec: OpenCode as a third MCP client

## Goal

agentMotoride works today in the terminal and as an MCP server for Claude Code and Codex. I want a rider who uses OpenCode to be able to connect it, plan rides in plain words, and find that on the website and in the guide, next to Claude Code and Codex.

## Assumptions

- "Support" means the existing stdio MCP server works in OpenCode and the docs say how to connect it. It does not mean a new mode, a new tool or a new client-specific code path (ADR 0004: two modes, shared tools).
- The other agent-client names (Codex, Claude Code) stay. OpenCode is added to the lists and not swapped in.
- The phone/remote-control flows (`from-your-phone`, `chat-on-your-phone`) are Claude and ChatGPT app features. They stay as they are and do not claim OpenCode.
- A project-level `opencode.json` is the right way to register the server for OpenCode, as `.mcp.json` is for Claude Code. See open questions.

## Requirements

1. The repository SHALL ship an OpenCode project configuration that registers the `ride` MCP server (stdio, `node --env-file-if-exists=.env src/mcp.ts`), so that starting OpenCode in the project directory offers the ride tools.
2. The guide page "Claude Code and Codex" SHALL also cover OpenCode, in the page, its title and its sidebar entry: how to connect it (project file and a once-per-machine user-level registration), and what differs from the other two (tool approval, slash commands, subagents).
3. The website (`site/index.html`) SHALL name OpenCode wherever it names "Claude Code or Codex" as the way to use the tools, except where the text is about the phone apps (Requirement 5).
4. The README, the guide index, getting-started and the other guide pages that list the supported MCP clients SHALL name OpenCode next to Claude Code and Codex, and `NOTICE.md` SHALL list OpenCode among the trademarks named.
5. Text that describes a feature only Claude or ChatGPT apps provide (remote control from the phone) SHALL NOT claim OpenCode support.
6. The MCP server SHALL remain client-neutral: no OpenCode-specific behaviour is added to the server, its tools or its instructions.
7. The docs SHALL NOT state that a Claude Code only feature (slash commands `/mcp__ride__*`, `@ride:` attachments, subagent scouts, elicitation forms) works in OpenCode unless it was checked; where unchecked, the docs SHALL say plain words work and describe the fallback (the model explores the areas itself).

## Scenarios

### 1. Project file

- **WHEN** a rider starts OpenCode in the project directory
- **THEN** the `ride` server is listed and "show roadbook 7" reaches the ride tools
- **EDGE: WHEN** OpenCode is started from another directory **THEN** the guide says to use the user-level registration with absolute paths, as for Claude Code and Codex.

### 2. Guide

- **WHEN** a reader opens the guide sidebar
- **THEN** the page title and the link text name Claude Code, Codex and OpenCode, and the `/claude-code-and-codex` link target keeps working (renamed page keeps a redirect or the old path is kept).

### 3. Website

- **WHEN** a visitor reads the "ways to use it" and feature sections
- **THEN** each place that said "Claude Code or Codex" now names OpenCode too.
- **EDGE:** the "From your phone" card still talks only of Claude and ChatGPT apps (Requirement 5).

### 4. Unchecked features

- **WHEN** the guide lists slash commands, attachments or subagent scouts
- **THEN** OpenCode is not listed as having them without a check, and the page says plain words work everywhere.

## Out of scope

- A `npm run opencode:register` script (the user-level step is documented as a command or snippet; the script can follow if wanted).
- Changing the server, tools, prompts or resources; an OpenCode-specific slash-command or agent file.
- Phone remote-control for OpenCode.
- Tests of the docs text; new tooling.

## Conflicts with existing specs

- `openspec/specs/mcp-server/spec.md`, requirement "Client portability" (any MCP client over stdio; scenarios name Codex CLI and Claude Code): consistent. Add a scenario "OpenCode" under it, in the same PR, as the spec-first rule asks. No requirement changes.
- `openspec/specs/multi-user-server/spec.md` line 5 ("from Claude Code or Codex" over HTTPS): untouched. OpenCode over HTTPS to a hosted server is not claimed (open question).
- ADR 0004 (two modes, shared tools) and ADR 0017 (elicitation and resources): consistent; nothing new in the server.
- `AGENTS.md` rules: a README/guide change goes with the change; no `src/` change is expected, so no `no-spec` is needed because the spec gets the scenario.
- Others: none.

## Open questions

- I could not check OpenCode's current configuration format here (no network, no OpenCode install). I recall a project `opencode.json` with an `mcp` entry of `type: "local"`, a `command` array and `environment`, and a user-level `~/.config/opencode/opencode.json`. The file in Requirement 1 and the guide snippet depend on that and must be checked against OpenCode's documentation, or by running it, before merge.
- Does OpenCode honour the server instructions and the `planningGuide` flow, and does it ask approval for each tool call? This changes only the guide text (Requirement 7), not the design.
- Should multi-user HTTPS mode (OAuth) be documented for OpenCode? Left out until someone has tested it.
