# Spec: OpenCode as a supported MCP client

**Round 2, what changed:** the token claim is corrected (the OpenCode block holds no literal token; existing lines unchanged); the requirements now live in `openspec/specs/` (new requirement "OpenCode project file" in `mcp-server`, scenarios in `multi-user-server`); unverified OpenCode behaviour is no longer promised (the guide says what we checked and no more); R7 lists exact files; tests for the connection text, the working-directory limit and OAuth-on are added.

## Goal

agentMotoride works today in the terminal and in Claude Code or Codex. We want OpenCode to be a supported client too: a rider who uses OpenCode connects the ride tools as easily as in Claude Code or Codex, can follow a guide page that says how, and sees OpenCode named wherever the website, the README and the guide list the supported clients. The server itself is a plain MCP server and does not change; we add only what is missing.

## Requirements

1. The server SHALL need no change to work with OpenCode: over stdio it SHALL expose the same tools, prompts, resources and instructions as for any MCP client (existing "Client portability").
2. The repository SHALL ship an `opencode.json` at its root with `mcp.ride` = `{ "type": "local", "command": ["node", "--env-file-if-exists=.env", "src/mcp.ts"], "enabled": true }` and no secret (spec: `mcp-server`, "OpenCode project file").
3. A test SHALL check that `opencode.json` parses, that those three values hold, that no string in it looks like a key or token, and that the file named in `command` exists.
4. `connectionText` (`src/admin.ts`) SHALL keep the Claude Code and Codex lines as they are and add an OpenCode block: `opencode.json` entry `mcp.ride` of `type: "remote"`, `url` = `<base>/mcp`, `headers.Authorization` = `Bearer {env:RIDE_TOKEN}`. The OpenCode block SHALL NOT contain the literal token; the text SHALL tell the rider to `export RIDE_TOKEN=<token>` (the Codex comment already does; the OpenCode block points to it).
5. A test SHALL check `connectionText` for: the OpenCode block present; the URL ends in `/mcp` (trailing slash on the base removed); `{env:RIDE_TOKEN}` present; the block free of the token (the token appears in the three existing places only); and, with `RIDE_SERVER_URL` unset and no `base` argument, the address `https://YOUR-SERVER/mcp`.
6. A valid rider token sent as `Authorization: Bearer` on `/mcp` SHALL be accepted when `RIDE_OAUTH` is on, as when it is off (existing behaviour; a test SHALL pin it if none does).
7. The guide SHALL have an OpenCode tab in the connect block giving: the project file (works when OpenCode is started at the clone's root), the user config entry with absolute paths for use from anywhere, the hosted-server entry of R4, and "say it in plain words". It SHALL make no claim about slash commands from MCP prompts or about parallel subagents in OpenCode: only what the plain-words path does (`planningGuide`).
8. The guide page SHALL be titled "Claude Code, Codex and OpenCode" (menu entry and heading); its address `/claude-code-and-codex` SHALL keep working.
9. The README comparison table SHALL say that in OpenCode the model is the one the rider configured there, not `RIDE_MODEL`, and that the plan used is the rider's own.
10. Every file in this list that names the supported clients SHALL name OpenCode too: `README.md`, `site/index.html`, `docs/how-it-works.svg` (text and picture), `docs/ENGINEERING.md`, `.env.example`, `NOTICE.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, `docs/guide/*.md` (including `getting-started`, `several-riders`, `self-hosting`, `sessions`, `settings`, `library`, `plan-a-ride`, `limits`, `everything`, `import-a-route`, `chat-on-your-phone`, `index`), `docs/guide/.vitepress/config.mts`, `scripts/reference.ts` (and so the regenerated `docs/guide/reference.md`), and the comments in `src/admin.ts`, `src/oauth.ts`, `src/tenants.ts`, `src/capabilities.ts`, `src/server.ts`. **Excluded on purpose:** `CHANGELOG.md` (generated history), `docs/adr/*` (immutable records), `ROADMAP.md` (items already shipped under their own name), and hits about Codex-only facts (`~/.codex/config.toml`, `codex:register`). A test SHALL read the listed files and fail if a line matching `Claude Code,? (or|and) Codex` lacks `OpenCode` on the same sentence; excluded files are not read.
11. The guide SHALL state the limit: a project `opencode.json` is read from where OpenCode finds it, but `src/mcp.ts` and `.env` resolve from OpenCode's working directory, so start it at the clone's root or use the user entry with absolute paths (the same limit as `.mcp.json`).

## Scenarios

**R1/R2: OpenCode in the project**
- WHEN the rider starts `opencode` at the clone's root and asks "plan me a ride this Saturday, under 250 km"
- THEN the `ride` tools are available and the model calls `planningGuide` first.
- Edge: WHEN `.env` does not exist, THEN the server still starts.

**R3: schema and secrets**
- WHEN `opencode.json` is parsed by the test
- THEN `mcp.ride.type` is `local`, `command[0]` is `node`, `enabled` is true, `src/mcp.ts` exists, and no key or token string is present.

**R4/R5: connection text**
- WHEN the administrator adds a rider with token `T`
- THEN the Claude Code and Codex lines are as before (each holds `T`), the OpenCode block holds `{env:RIDE_TOKEN}` and not `T`, and the `/mcp` URL.
- Edge: WHEN `RIDE_SERVER_URL` is unset, THEN the address is `https://YOUR-SERVER/mcp`; WHEN the base ends in `/`, THEN there is no double slash.

**R6: sign-in on**
- WHEN `RIDE_OAUTH` is on and OpenCode sends the static header
- THEN `/mcp` answers as it does with sign-in off; a missing or wrong token still gets 401 with the discovery header.

**R7: guide**
- WHEN a visitor opens the page
- THEN the OpenCode tab shows the three ways of R7 and says "plain words"; it does not mention slash commands or subagents for OpenCode.
- Edge: WHEN the VitePress build runs, THEN no dead link results.

**R8: title and address**
- WHEN a visitor opens `/claude-code-and-codex`
- THEN the page opens titled for the three clients.

**R9: comparison**
- WHEN the README table is read
- THEN the "What runs the agent" and "What you pay with" cells name OpenCode with the rider's configured model.

**R10: no client forgotten**
- WHEN the test reads the listed files
- THEN every matching sentence names OpenCode; a Codex-only line (`~/.codex/config.toml`) is not matched.
- Edge: `docs/how-it-works.svg` is read as text.

**R11: other directory**
- WHEN OpenCode is started in a subdirectory of the clone or elsewhere
- THEN the guide has already said that the project entry may not resolve and to use the user entry with absolute paths.

## Out of scope

- Any server code change for OpenCode, unless running it reveals a real incompatibility (then a new requirement).
- A `npm run opencode:register` script.
- OAuth sign-in for OpenCode against the hosted server (static token header only; R6 only keeps it working).
- Renaming the guide URL, or the `codex/` folder.
- An OpenCode plugin, agents or custom commands; promises about OpenCode slash commands or subagents.
- Copying the quality gate (`npm run quality`, `openspec validate --all`) into the specs: it is a task, not a requirement.

## Conflicts with existing specs

- `openspec/specs/mcp-server/spec.md`, "Client portability": scenario "OpenCode" added; new requirement "OpenCode project file". No tool, hint or instruction changes. "Client scouting when API scouts are off": untouched ("when the client can").
- `openspec/specs/multi-user-server/spec.md`: purpose line and "Administration" extended (OpenCode entry; scenarios "Connection text names OpenCode" and "Static token with sign-in on"). It does not say the token appears once; the Claude Code and Codex lines keep the token as today. "Tenants and their tokens", OAuth requirements: unchanged.
- `openspec/specs/cli/spec.md`, `docs/adr/0004-two-modes-shared-tools.md`, `0017` (MCP elicitation, not sampling): unchanged; OpenCode is MCP mode. No ADR needed. No decision record is contradicted.
- `src/` changes (`connectionText`, comments) come with these specs in the same PR, so the spec check is satisfied.

## Open questions

- **OpenCode was not run and its documentation could not be fetched here** (web access refused), so these are unverified: `mcp.<name>.type`/`command`/`headers` keys, `{env:…}` substitution in `headers`, the working directory of a local server, and whether a `remote` entry with a static header avoids an automatic OAuth attempt. The requirements above use the shape OpenCode documents as we know it and promise nothing beyond it. **If the key names or substitution differ, R2 to R5 change (the shape of two JSON blocks); if a static header does not work with OpenCode at all, R4 and R6 change.** To confirm by running `opencode` or reading its docs before merge.
- Rename the page and menu entry while keeping the address: assumed yes.
- Tools: no `mise.toml`, `.tool-versions` or Node in this sandbox, so `npm run quality` and `openspec validate --all` were NOT run; the spec edits are unvalidated.
- Also noted, not part of this work: `multi-user-server/spec.md` cites "ADR 0027", but `docs/adr/` has no such file under 0025 in the list given (an ADR 0056 exists); fix separately.
- The pull request title must be conventional, e.g. `feat(mcp): support OpenCode`.
