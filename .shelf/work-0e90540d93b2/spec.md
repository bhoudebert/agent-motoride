Round 1: facts about OpenCode are now stated with their source or marked unverified, and the guide asserts only the first kind; the sweep of "Claude Code or Codex" is defined and named; the page keeps its filename and URL; the scenario text for OpenCode is written; only the documented snippet ships (no project config file).

# OpenCode as a supported client

## 1. Goal

Today the product says it works in the terminal and in Claude Code or Codex. We want a rider who uses OpenCode to find, in the guide, the README and the website, that OpenCode works too, and how to connect it, the same way Codex is presented. OpenCode appears nowhere in the repository today (code, specs, guide, site), so documentation and one spec scenario are missing. The server needs no change: it is a stdio MCP server.

## 2. What is known about OpenCode

Source: OpenCode docs, `https://opencode.ai/docs/mcp-servers/` and `https://opencode.ai/docs/commands/`, read on 2026-11-15 through a page-summarising fetch. I could not run OpenCode.

Confirmed by the docs:

- Config file `opencode.jsonc` (`$schema` `https://opencode.ai/config.json`). `opencode mcp add` writes the server to the project configuration; `--global` makes it available in every project. The global file's path is not given on the page.
- A local server is declared under `mcp.servers.<name>` with `"type": "local"`, `"command"` as an array (executable, then arguments), `"environment"` as an object of strings, and `"disabled": true` to keep it configured but not connected. The page warns that "V2 does not place server names directly under `mcp`", so older OpenCode versions use another layout.
- Tool names are normalised to `<server>_<tool>`. A rule in a `permissions` array (`action`, `resource`, `effect`) can match them by glob (`context7_*`); `allow` and `deny` are shown as effects.

Not confirmed (the docs pages read are silent): whether MCP prompts appear as slash commands; whether OpenCode runs subagents in parallel for an MCP client; whether an `ask` effect exists; whether tools run without confirmation by default.

## 3. Requirements

1. The guide's connect page SHALL have an OpenCode tab beside Claude Code and Codex with the minimal snippet from section 2: the `ride` server as `"type": "local"` with `command` `["node", "--env-file-if-exists=/abs/path/agent-motoride/.env", "/abs/path/agent-motoride/src/mcp.ts"]` and `environment` `RIDE_SCOUTS` `"0"`, in `opencode.jsonc`, and SHALL tell the rider to replace `/abs/path` and to check the layout against the docs link for their OpenCode version.
2. The guide SHALL describe OpenCode only with what section 2 confirms. It SHALL NOT state that OpenCode shows slash commands for the ride prompts, runs subagents, or asks or does not ask before a tool call; for the unconfirmed points it SHALL say they were not checked and that plain words (which need nothing client-specific) are the way in.
3. The page `docs/guide/claude-code-and-codex.md` SHALL keep its filename and URL; only its title, opening paragraph and text name OpenCode. The menu entry in `docs/guide/.vitepress/config.mts` and the home tagline in `docs/guide/index.md` SHALL name OpenCode.
4. Every sentence that lists MCP clients as "Claude Code or Codex" (or "Claude Code and Codex") SHALL also name OpenCode. This covers `README.md`, `site/index.html`, the guide pages `getting-started.md` (including the comparison table), `plan-a-ride.md`, `library.md`, `settings.md`, `limits.md`, `self-hosting.md`, `several-riders.md` and any other guide page `grep -i codex` finds that lists clients, and the figure `docs/how-it-works.svg`. Where a sentence is about Codex alone (its registration, its approval key, its lack of slash commands) or about the phone (Claude or ChatGPT app, `claude remote-control`) it SHALL NOT change.
5. The generated reference SHALL be changed at its source: the heading and sentences in `scripts/reference.ts` (lines 3, 126, 174, 178) name OpenCode, and `docs/guide/reference.md` is regenerated with `npm run docs:reference`, not edited by hand. Reference text that comes from `.env.example` or the tools' descriptions in `src/` is changed only if it lists MCP clients, and then at its source.
6. The `mcp-server` spec SHALL gain, under "Client portability", the scenario in section 4. No server, tool or prompt behaviour SHALL change, and no test is added.

## 4. Scenarios

- Req 1
  - WHEN a rider opens the connect page and picks the OpenCode tab
  - THEN they see the snippet above and the note to replace `/abs/path`.
  - Edge: WHEN the rider's OpenCode is an older version with another layout, THEN the page's link to the OpenCode docs and the note to check them is what they follow; the page makes no claim about older layouts.
- Req 2
  - WHEN the guide is read for OpenCode's slash commands, subagents or approval
  - THEN it states none of them as fact and says it was not checked.
- Req 3
  - WHEN a link to `/claude-code-and-codex` from the README, `several-riders.md`, `chat-on-your-phone.md` or an older page is opened
  - THEN it resolves.
- Req 4
  - WHEN the listed files are searched for "Claude Code or Codex" and "Claude Code and Codex"
  - THEN no sentence about MCP clients names only those two. Edge: the phone lines and the Codex-only sentences are unchanged.
- Req 5
  - WHEN `npm run docs:reference` is run after the change
  - THEN `docs/guide/reference.md` names OpenCode in the same places and the run shows no other difference.
- Req 6, the scenario to add to `mcp-server`:
  - **Scenario: OpenCode**
  - **WHEN** the server is declared in OpenCode's `opencode.jsonc` as a local server running `node ... src/mcp.ts`, and the rider asks for a ride in plain words
  - **THEN** the model receives the server instructions, which ask it to call `planningGuide` before planning, as in any MCP client.
  - Verification is documentary: the scenario rests on the existing "any MCP client over stdio" requirement and the existing end-to-end tests of the server; I do not claim OpenCode's behaviour was run.

## 5. Out of scope

- A register script like `npm run codex:register`, and any shipped OpenCode config file in the repository (only the documented snippet ships).
- Any code or test change.
- Driving OpenCode from the phone, OpenCode as a remote client of the hosted server (OAuth sign-in is specified for ChatGPT and Claude only), and a model recommendation for OpenCode.

## 6. Conflicts with existing specs

- `mcp-server`, "Client portability": adds a scenario beside "Codex CLI" and "Claude Code"; the Codex scenario (`npm run codex:register`, `default_tools_approval_mode`) is untouched and the new one states its own registration. "Any MCP client over stdio" already covers OpenCode: no contradiction.
- `mcp-server`, "Client scouting when API scouts are off": unchanged. The snippet sets `RIDE_SCOUTS=0`; whether OpenCode can run the subagent brief is not claimed (Req 2).
- `multi-user-server` (purpose line and the scenario "A client that is not ChatGPT or Claude"): untouched; OpenCode stays out of the hosted-server wording.
- ADR 0004 (two modes, shared tools), ADR 0017 (elicitation and resources, not sampling) and ADR 0021 (client subagents scout when API scouts are off): consistent, no new protocol use, and OpenCode is not said to use ADR 0021's mechanism.
- AGENTS.md rule 3: the PR touches `openspec/specs/mcp-server/spec.md`; rule 6: the guide, README and site travel with it.

## 7. Open questions

- The fetched docs describe a "V2" layout (`mcp.servers`) and say older versions differ; the summarising fetch may also have misread the page. The design must re-read the page, or run `opencode mcp add`, before the snippet is written. If it cannot be confirmed, the guide gives the command `opencode mcp add` and the values to enter, not a file layout. This changes what Req 1 shows, not the design of the work.
- The `permissions` array is documented for deny and hide; no documented way to let every ride tool run without a prompt was found. If none exists, Req 1's guide says nothing about approval (Req 2).
- Markdown lint: Prettier is off for this folder and I ran no other linter on this file.
