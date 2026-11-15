# OpenCode as a supported client

## 1. Goal

Today the product says it works in the terminal and in Claude Code or Codex. We want a rider who uses OpenCode to find, in the guide, the README and the website, that OpenCode works too, and how to connect it, the same way Codex is presented. I read the repository: the word "OpenCode" appears nowhere in it (code, specs, guide, site), so this is more than a check; documentation and one spec scenario are missing.

## 2. Requirements

1. The guide SHALL show how to register the ride MCP server in OpenCode (a code-group tab beside Claude Code and Codex on the connect page), with absolute paths, and how to let the ride tools run without a prompt for every call.
2. The guide page SHALL name OpenCode in its title and opening paragraph, and the guide's menu entry and home tagline SHALL name it wherever they name Claude Code or Codex. Existing page URLs SHALL keep working.
3. The README (comparison table, "how to use it" lines, MCP-mode line) and the website (`site/index.html`: the "Three ways in" card, the map caption, the "works from" lines, the commands line) SHALL name OpenCode wherever they name Claude Code or Codex as MCP clients.
4. The guide SHALL say what differs in OpenCode: which of plain words, slash commands and client subagents (scouts with `RIDE_SCOUTS=0`) it offers, and the fallback when it has no subagents.
5. The `mcp-server` spec SHALL carry a scenario for OpenCode under "Client portability", stating how it is registered and that plain words reach `planningGuide` and the tools.
6. The server, its tools and its prompts SHALL NOT change: OpenCode uses the existing stdio server.

## 3. Scenarios

- Req 1
  - WHEN a rider opens the connect page and picks the OpenCode tab
  - THEN they see the config to add (file, server name `ride`, the `node` command with `--env-file-if-exists` and `src/mcp.ts` by absolute path, `RIDE_SCOUTS=0`) and the setting that stops per-call confirmation.
  - Edge: WHEN the rider copies it without changing `/abs/path`, THEN the page says plainly to replace it, as it does for Claude Code.
- Req 2
  - WHEN a link to `/claude-code-and-codex` from an older page, ADR or issue is opened
  - THEN it still resolves.
- Req 3
  - WHEN the README and the site are searched for "Claude Code or Codex"
  - THEN no sentence about MCP clients lists only those two. Edge: the "phone" lines (Claude or ChatGPT app, `claude remote-control`) are not changed, see Out of scope.
- Req 4
  - WHEN the rider asks "what can you do?" in OpenCode
  - THEN the guide says whether that works, and what to say instead of a slash command if OpenCode shows none.
- Req 5
  - WHEN the server is registered in OpenCode and the rider asks for a ride in plain words
  - THEN the model receives the server instructions, calls `planningGuide` and plans with the tools.
- Req 6
  - WHEN the existing MCP end-to-end tests run
  - THEN they pass unchanged.

## 4. Out of scope

- A script like `npm run codex:register` for OpenCode, and any code change.
- Driving OpenCode from the phone, and OpenCode as a remote client of the hosted server (OAuth sign-in is specified for ChatGPT and Claude only).
- Choosing or recommending a model for OpenCode.

## 5. Conflicts with existing specs

- `mcp-server`, "Client portability": adds a scenario; "any MCP client over stdio" already covers OpenCode, so no contradiction.
- `mcp-server`, "Client scouting when API scouts are off": unchanged; Req 4 only documents how OpenCode behaves under it.
- `multi-user-server` (purpose line, and the scenario "A client that is not ChatGPT or Claude"): untouched; OpenCode stays out of the hosted-server wording.
- ADR 0004 (two modes, shared tools) and ADR 0017 (elicitation and resources, not sampling): consistent, same tools and no new protocol use.
- AGENTS.md rule 3: the PR touches `openspec/specs/mcp-server/spec.md`, and the guide, README and site travel with it (rule 6).

## 6. Open questions

- I could not run OpenCode or read its documentation here, so its config file name, the key layout for a local MCP server, and how to skip tool approval are unchecked. The design must confirm them against the OpenCode docs before the guide states them.
- Does OpenCode expose MCP prompts as slash commands, and does it run subagents? The answer sets the wording of Req 4.
- If OpenCode reads a project-level config, should the repository ship one (as it ships `.mcp.json` for Claude Code), or only document the snippet? Shipping one changes the files in the repository; I specified only the documentation.
- Should the page be renamed (and a redirect added), or keep its URL and change only the title? I assumed the URL stays.
- Markdown lint: the repository's formatter is Prettier, which is switched off for this folder, and I did not run another one on this file.
