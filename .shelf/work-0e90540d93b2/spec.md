Round 2: Req 1 now has one form (`opencode mcp add` with the values to enter, no file layout); the site's "Claude Code or Codex" card and the phone card are told apart; line numbers dropped from Req 5; the figure's fate is decided.

# OpenCode as a supported client

## 1. Goal

Today the product says it works in the terminal and in Claude Code or Codex. We want a rider who uses OpenCode to find, in the guide, the README and the website, that OpenCode works too, and how to connect it, the same way Codex is presented. OpenCode appears nowhere in the repository today (code, specs, guide, site), so documentation and one spec scenario are missing. The server needs no change: it is a stdio MCP server.

## 2. What is known about OpenCode

Source: OpenCode docs, `https://opencode.ai/docs/mcp-servers/` and `https://opencode.ai/docs/commands/`, read on 2026-11-15 through a page-summarising fetch. I could not run OpenCode.

Confirmed by the docs:

- `opencode mcp add` adds an MCP server to the project configuration; `--global` makes it available in every project.
- A local server has a type `local` and a command (executable, then arguments). The docs also show a file layout for it, which this spec does not use: a summarised read of the page could not be trusted on it, and older versions are said to differ.

Not confirmed (the docs pages read are silent): whether MCP prompts appear as slash commands; whether OpenCode runs subagents in parallel for an MCP client; how to let tools run without confirmation; whether `opencode mcp add` asks for environment variables (the tab lists `RIDE_SCOUTS=0` and points to the docs).

## 3. Requirements

1. The guide's connect page SHALL have an OpenCode tab beside Claude Code and Codex that gives the command `opencode mcp add` and the values to enter: name `ride`, type local, command `node --env-file-if-exists=/abs/path/agent-motoride/.env /abs/path/agent-motoride/src/mcp.ts`, and `RIDE_SCOUTS=0`. It SHALL tell the rider to replace `/abs/path`, and link the OpenCode MCP docs for anything else. It SHALL NOT show a config-file layout.
2. The guide SHALL describe OpenCode only with what section 2 confirms. It SHALL NOT state that OpenCode shows slash commands for the ride prompts, runs subagents, or asks or does not ask before a tool call; for the unconfirmed points it SHALL say they were not checked and that plain words (which need nothing client-specific) are the way in.
3. The page `docs/guide/claude-code-and-codex.md` SHALL keep its filename and URL; only its title, opening paragraph and text name OpenCode. The menu entry in `docs/guide/.vitepress/config.mts` and the home tagline in `docs/guide/index.md` SHALL name OpenCode.
4. Every sentence that lists MCP clients as "Claude Code or Codex" (or "Claude Code and Codex") SHALL also name OpenCode. This covers `README.md`, `site/index.html`, the guide pages `getting-started.md` (including the comparison table), `plan-a-ride.md`, `library.md`, `settings.md`, `limits.md`, `self-hosting.md`, `several-riders.md` and any other guide page `grep -i codex` finds that lists clients. In `site/index.html` the "Three ways in" card headed "Claude Code or Codex" (the MCP way in) SHALL change, heading and text. The card "From your phone" (it says "Leave a Claude Code or Codex session running ... drive it from the Claude or ChatGPT app") SHALL stay as it is, with the other phone lines (`claude remote-control`), since OpenCode on the phone is out of scope. A sentence about Codex alone (its registration, its approval key, its lack of slash commands) SHALL NOT change. The figure `docs/how-it-works.svg` and its PNG exports, which the README shows, are left as they are (see section 5).
5. The generated reference SHALL be changed at its source: the places in `scripts/reference.ts` that list clients (a comment, a heading and two sentences) name OpenCode, and `docs/guide/reference.md` is regenerated with `npm run docs:reference`, not edited by hand. Reference text that comes from `.env.example` or the tools' descriptions in `src/` is changed only if it lists MCP clients, and then at its source.
6. The `mcp-server` spec SHALL gain, under "Client portability", the scenario in section 4. No server, tool or prompt behaviour SHALL change, and no test is added.

## 4. Scenarios

- Req 1
  - WHEN a rider opens the connect page and picks the OpenCode tab
  - THEN they see `opencode mcp add`, the four values to enter and the note to replace `/abs/path`, and a link to the OpenCode docs.
  - Edge: WHEN the rider's OpenCode differs from what the page assumes, THEN the docs link is what they follow; the page shows no file layout that could be wrong.
- Req 2
  - WHEN the guide is read for OpenCode's slash commands, subagents or approval
  - THEN it states none of them as fact and says it was not checked.
- Req 3
  - WHEN a link to `/claude-code-and-codex` from the README, `several-riders.md`, `chat-on-your-phone.md` or an older page is opened
  - THEN it resolves.
- Req 4
  - WHEN the listed files are searched for "Claude Code or Codex" and "Claude Code and Codex"
  - THEN no sentence about MCP clients names only those two, except the site's phone card and the Codex-only sentences, which are unchanged.
  - Edge: WHEN the site's "Three ways in" section is read, THEN the middle card names OpenCode and the "From your phone" card reads as before.
- Req 5
  - WHEN `npm run docs:reference` is run after the change
  - THEN `docs/guide/reference.md` names OpenCode in the same places and the run shows no other difference.
- Req 6, the scenario to add to `mcp-server`:
  - **Scenario: OpenCode**
  - **WHEN** the server is added to OpenCode as a local MCP server (`opencode mcp add`) running `node ... src/mcp.ts`, and the rider asks for a ride in plain words
  - **THEN** the model receives the server instructions, which ask it to call `planningGuide` before planning, as in any MCP client.
  - Verification is documentary: the scenario rests on the existing "any MCP client over stdio" requirement and the existing end-to-end tests of the server; I do not claim OpenCode's behaviour was run.

## 5. Out of scope

- A register script like `npm run codex:register`, and any shipped OpenCode config file in the repository (only the documented snippet ships).
- Any code or test change.
- The figure `docs/how-it-works.svg` and its PNG exports (the README shows the PNG; no script in the repository exports them, and a longer line may not fit the box), which keep saying "Claude Code or Codex".
- Driving OpenCode from the phone, OpenCode as a remote client of the hosted server (OAuth sign-in is specified for ChatGPT and Claude only), and a model recommendation for OpenCode.

## 6. Conflicts with existing specs

- `mcp-server`, "Client portability": adds a scenario beside "Codex CLI" and "Claude Code"; the Codex scenario (`npm run codex:register`, `default_tools_approval_mode`) is untouched and the new one states its own registration. "Any MCP client over stdio" already covers OpenCode: no contradiction.
- `mcp-server`, "Client scouting when API scouts are off": unchanged. The snippet sets `RIDE_SCOUTS=0`; whether OpenCode can run the subagent brief is not claimed (Req 2).
- `multi-user-server` (purpose line and the scenario "A client that is not ChatGPT or Claude"): untouched; OpenCode stays out of the hosted-server wording.
- ADR 0004 (two modes, shared tools), ADR 0017 (elicitation and resources, not sampling) and ADR 0021 (client subagents scout when API scouts are off): consistent, no new protocol use, and OpenCode is not said to use ADR 0021's mechanism.
- AGENTS.md rule 3: the PR touches `openspec/specs/mcp-server/spec.md`; rule 6: the guide, README and site travel with it.

## 7. Open questions

None that changes what is built. Markdown lint: Prettier is off for this folder and I ran no other linter on this file.
