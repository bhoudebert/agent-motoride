# Spec: OpenCode as a supported MCP client

**Round 4, what changed:** R8 and R9 are now in `mcp-server` (they were missing), with scenarios; R10 has a precise test rule (URL stripping, what a unit is per file type, how Claude/Codex/OpenCode are matched, worked examples) and its test file; R3 names its token patterns and test file; R5 names its test file; the OpenCode syntax check is a gate before the guide's OpenCode blocks are written, and says what changes if it fails; R6's 401 half is checked against `test/oauth.test.ts`; R11 is marked provisional in the guide.

## Goal

agentMotoride works today in the terminal and in Claude Code or Codex. We want OpenCode to be a supported client too: a rider who uses OpenCode connects the ride tools as easily as in Claude Code or Codex, can follow a guide page that says how, and sees OpenCode named wherever the website, the README and the guide list the supported clients. The server itself is a plain MCP server and does not change; we add only what is missing.

## Requirements

1. The server SHALL need no change to work with OpenCode: over stdio it SHALL expose the same tools, prompts, resources and instructions as for any MCP client (existing "Client portability").
2. The repository SHALL ship an `opencode.json` at its root with `mcp.ride` = `{ "type": "local", "command": ["node", "--env-file-if-exists=.env", "src/mcp.ts"], "enabled": true }` and no secret (`mcp-server`, "OpenCode project file").
3. `test/opencodeConfig.test.ts` SHALL check that `opencode.json` parses, that those three values hold, that the file named in `command` exists, and that no string value matches `/sk-[A-Za-z0-9_-]{8,}|mrt_|mro_|mrx_|Bearer\s+[A-Za-z0-9._-]{16,}|[A-Za-z0-9_-]{32,}/` (API-key shape, the repository's token prefixes, any long opaque string).
4. `connectionText` (`src/admin.ts`) SHALL keep the Claude Code and Codex lines unchanged and add, after them, an OpenCode block: `opencode.json` entry `mcp.ride` of `type: "remote"`, `url` = `<base>/mcp`, `headers.Authorization` = `Bearer {env:RIDE_TOKEN}`, with a comment that the rider exports `RIDE_TOKEN` as the Codex comment above says. The block SHALL NOT contain the literal token (`multi-user-server`, "Administration").
5. A new case in `test/tenants.test.ts` (where `connectionText` is already tested) SHALL check `connectionText` for: the OpenCode block present and after the Codex block; the URL ends in `/mcp` (trailing slash on the base removed, no double slash); `{env:RIDE_TOKEN}` present; the token appearing exactly three times, in the "Token (shown once…)" line, the Claude Code line and the Codex comment, and not in the OpenCode block; and, with `RIDE_SERVER_URL` unset and no `base` argument, the address `https://YOUR-SERVER/mcp`.
6. A valid rider token sent as `Authorization: Bearer` on `/mcp` SHALL be accepted when `RIDE_OAUTH` is on, as when it is off. This already holds (`src/server.ts`, `registry.verify` is tried before `oauth?.verify`). Pinned by `test/oauth.test.ts`: the valid rider token is not 401 with sign-in on ("a rider connects with a one-time code…", last assertion); no token gets 401 with `WWW-Authenticate: Bearer resource_metadata=…` ("the metadata says where to sign in, and a 401 points at it"); an expired or replaced access token gets 401 (the same file, `mcpStatus(...) === 401` assertions). No new test; no code change.
7. The guide SHALL have an OpenCode tab in the connect block of `docs/guide/claude-code-and-codex.md` giving: the project file, the user config entry with absolute paths, the hosted-server entry of R4, and "say it in plain words". It SHALL claim nothing about OpenCode slash commands or parallel subagents.
8. The guide page SHALL be titled "Claude Code, Codex and OpenCode" (menu entry in `docs/guide/.vitepress/config.mts` and heading); its address `/claude-code-and-codex` SHALL keep working.
9. The README comparison table SHALL say that in OpenCode the model is the one the rider configured there, not `RIDE_MODEL`, and that the plan used is the rider's own. (R8 and R9 are in `mcp-server` with scenarios "Guide title" and "Comparison table".)
10. **The rule**, tested by `test/clientsNamedAlike.test.ts`, failing with file and line:
    1. URLs are removed first (`](…)`, `href=`/`src=` values, bare `https?://…`), so `claude-code-and-codex` in an address is neither a name nor a false hit; link text stays.
    2. A *unit* is: a Markdown table row (whole row, never split); a heading; a list item or paragraph (wrapped lines joined, up to a blank line, list marker, heading or code fence), cut into sentences at `.`/`!`/`?` + whitespace + upper-case letter, digit, quote or bracket; in HTML, the text of one element with tags removed, cut the same way; in SVG, the joined text of one `<text>` element; in `.ts` and `.env.example`, one comment (`//`, `#`, `/** */`) joined across its lines, cut the same way. Code outside comments is not read.
    3. A unit names Claude when it holds the word `Claude` (so "Claude Code" counts), Codex when it holds the word `Codex`; case-sensitive. A unit holding both SHALL hold `OpenCode`. The joiner is irrelevant: "or", "and", ",", "/" are all covered. Only `Codex`, or only `Claude` (a model, "the Claude or ChatGPT app"), is not flagged.
    4. Worked examples: the table row `| What runs the agent | … | Claude Code or Codex CLI … |` fails until it names OpenCode; `<h3>Claude Code or Codex</h3>` and the menu entry "Claude Code and Codex" (`config.mts`) fail; SVG `<text>Claude Code or Codex use the</text>` fails (the element is the unit); the comment `/** How a rider connects Claude Code or Codex … */` in `src/admin.ts` fails; README "Claude Code, Codex or another MCP client" fails.
    - **In:** `README.md`; `site/index.html`; `docs/how-it-works.svg` (read as text; the picture is edited too); `docs/ENGINEERING.md`; `.env.example`; `scripts/reference.ts` and the regenerated `docs/guide/reference.md`; every `docs/guide/*.md` that matches the rule today (glob `docs/guide/*.md`, no per-file list: no file is named, so none can be wrong); `docs/guide/.vitepress/config.mts`; comments in `src/admin.ts`, `src/oauth.ts`, `src/tenants.ts`, `src/capabilities.ts`, `src/server.ts`.
    - **Out, with reason:** `CHANGELOG.md` (generated history); `docs/adr/*` (immutable); `ROADMAP.md` (shipped items keep their name); `CONTRIBUTING.md`, `AGENTS.md` (commit scopes and agent rules, no client list); `NOTICE.md` (a trademark list: OpenCode is added there as a name, but it is not a client sentence); `docs/EVOLVING.md` (Codex named as one agent that can run the review, not a client list); `src/rideServer.ts`, `scripts/mcp-smoke.ts` (Codex as the example of a client without slash commands, true for OpenCode too, no list); `.github/ISSUE_TEMPLATE/{country_rules,eval_case,feature_request}.md` (no client list); `.github/ISSUE_TEMPLATE/bug_report.md` is **in** ("MCP (Claude Code, Codex)" → add OpenCode; also read by the test); `codex/config.example.toml`, `scripts/codex-register.ts`, `.dockerignore`, `package.json`, `commitlint.config.js` (Codex-only or tooling).
11. The guide SHALL say that `src/mcp.ts` and `.env` resolve from the directory OpenCode is started in, so OpenCode is started at the clone's root or the user entry with absolute paths is used (the same limit as `.mcp.json`). This is a guide statement, not a claim about OpenCode internals; it is verified in the pre-merge check below.

R7 to R11 are all in `openspec/specs/mcp-server/spec.md` as "Supported clients are named alike" (R8, R9 and the R10 rule included, with scenarios "Guide title", "Comparison table", "A kept address") (R2 and R3 as "OpenCode project file"; R4 to R6 in `multi-user-server`).

## Scenarios

**R1/R2: OpenCode in the project**
- WHEN the rider starts `opencode` at the clone's root and asks "plan me a ride this Saturday, under 250 km"
- THEN the `ride` tools are available and the model calls `planningGuide` first.
- Edge: WHEN `.env` does not exist, THEN the server still starts.

**R3: schema and secrets**
- WHEN `opencode.json` is parsed by the test
- THEN `mcp.ride.type` is `local`, `command` is the array of R2, `enabled` is true, `src/mcp.ts` exists, and no key or token string is present.
- Edge: WHEN a string like `sk-…` or `mrt_…` is added, THEN the test fails.

**R4/R5: connection text**
- WHEN the administrator adds a rider with token `T`
- THEN the Claude Code and Codex lines are as before; `T` is in the "Token" line, the Claude Code line and the Codex comment (three places); the OpenCode block holds `{env:RIDE_TOKEN}`, the `/mcp` URL and not `T`.
- Edge: WHEN `RIDE_SERVER_URL` is unset, THEN the address is `https://YOUR-SERVER/mcp`; WHEN the base ends in `/`, THEN there is no double slash.

**R6: sign-in on**
- WHEN `RIDE_OAUTH` is on and a rider token is sent in `Authorization: Bearer`
- THEN `/mcp` does not answer 401, as with sign-in off; no token still gets 401 with the discovery header, an expired token 401 (both in `test/oauth.test.ts`).

**R7/R11: guide**
- WHEN a visitor opens the page
- THEN the OpenCode tab shows the three ways, says "plain words", states the working-directory limit, and mentions no OpenCode slash commands or subagents.
- Edge: WHEN the VitePress build runs, THEN no dead link results.

**R8: title and address**
- WHEN a visitor opens `/claude-code-and-codex`
- THEN the page opens, titled for the three clients.

**R9: comparison**
- WHEN the README table is read
- THEN the "What runs the agent", "What you pay with" and "Model and effort" cells name OpenCode with the rider's configured model.

**R10: no client forgotten**
- WHEN the test reads the listed files
- THEN every sentence naming Claude and Codex also names OpenCode.
- Edge: a Codex-only sentence is not flagged; a link `[Claude Code, Codex and OpenCode](…/claude-code-and-codex)` passes, its address ignored; a wrapped sentence is one unit; a table row is one unit; an SVG `<text>` element is one unit.

## Out of scope

- Any server code change for OpenCode, unless running it reveals a real incompatibility (then a new requirement).
- A `npm run opencode:register` script.
- OAuth sign-in for OpenCode against the hosted server (static token header only; R6 only keeps it working).
- Renaming the guide URL, or the `codex/` folder.
- An OpenCode plugin, agents or custom commands; promises about OpenCode slash commands or subagents.
- Running the quality gate as a requirement: it is a task.

## Conflicts with existing specs

- `openspec/specs/mcp-server/spec.md`: "Client portability" gets a scenario "OpenCode"; new requirements "OpenCode project file" and "Supported clients are named alike". No tool, hint or instruction changes. "Client scouting when API scouts are off" is untouched ("when the client can").
- `openspec/specs/multi-user-server/spec.md`: purpose line and "Administration" extended; scenarios "Connection text names OpenCode" (token in three named places) and "Static token with sign-in on". "Tenants and their tokens" and the OAuth requirements are unchanged. The existing citation of ADR 0027 is valid (`docs/adr/0027-one-instance-one-sqlite-file-per-user.md`).
- `openspec/specs/cli/spec.md`, ADR 0004 (two modes, shared tools), ADR 0017 (elicitation, not sampling), ADR 0027: unchanged; OpenCode is MCP mode. No decision record is contradicted; none is needed.
- `src/` changes (`connectionText`, comments) come with these specs in the same PR, so the spec check is satisfied.

## Open questions

- **Gate before the guide's OpenCode blocks and R2 to R5 are written, by a person:** run `opencode` once (or read its docs) and confirm: the keys `mcp.<name>.type` / `command` / `enabled` / `url` / `headers`; `{env:RIDE_TOKEN}` substitution inside `headers`; that a `remote` entry with a static header does not start an OAuth attempt; and which directory a `local` server starts in. Not verified here (no OpenCode, web access refused). **If key names or substitution differ, R2 to R5 change (two JSON blocks); if a static header does not work, R4 and R6 change; if the working directory differs, R11's wording changes.** The author records the result in the pull request. If the check cannot be done, the guide blocks are marked "not yet checked against OpenCode", and R11 stays provisional in the guide; `test/opencodeConfig.test.ts` asserts only the file shape of R3, never OpenCode's behaviour, so it stays valid either way and changes together with R2 if the key names differ.
- Rename the page and menu entry while keeping the address: assumed yes.
- Tools: no `mise.toml` or `.tool-versions` is declared (`flake.nix` only), and `openspec` is not installed here: `openspec validate --all` and `npm run quality` were NOT run; the spec edits are unvalidated. The doc-wording test of R10 is new and not written yet (code is not part of this task).
- The pull request title must be conventional, e.g. `feat(mcp): support OpenCode`.
