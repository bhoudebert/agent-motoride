# Spec: OpenCode alongside Claude Code and Codex

Changed in round 1: OpenCode facts are now a gate before any text is written; the scope of "places that name the clients" is listed by file; remote and phone mentions stay as they are; the page keeps its file name and URL; no change to any openspec spec.

## Goal

Today the README, the guide and the website say agentMotoride works in the terminal and in "Claude Code or Codex". I want a rider who uses OpenCode to see that it works for them too, to know how to connect it, and to find OpenCode named wherever Claude Code and Codex are named as clients. This is documentation and an example config only; the server and its tools do not change.

What the repository shows: OpenCode appears nowhere. The server is a plain MCP server over stdio. Claude Code connects through the project's `.mcp.json`; Codex through `npm run codex:register` and `codex/config.example.toml`.

## Requirements

1. **Fact gate.** Before any OpenCode text or file is written, the design SHALL confirm from OpenCode's own documentation, and record in the design with the source and version: (a) the config file name and the keys for a local stdio MCP server (command, arguments, environment); (b) whether a project-level config is read, and where a user-level one lives; (c) whether a setting avoids a confirmation on every tool call. This analyst could not check these (no network, OpenCode not installed).
2. **If a fact is not confirmed**, the sentence that depends on it SHALL be left out of the guide, not guessed:
   - (a) not confirmed: no example file is shipped and the guide's OpenCode tab says only that the server is a standard stdio MCP server started with the same command as for the other clients, and links to OpenCode's MCP documentation;
   - (b) not confirmed: the guide and the example say where to copy the file only as far as confirmed;
   - (c) not confirmed: no approval advice is given.
3. **Guide.** The page `docs/guide/claude-code-and-codex.md` SHALL keep its file name and URL. Its title, the VitePress menu entry, and its text SHALL change to name OpenCode ("Claude Code, Codex and OpenCode"), and its connect code group SHALL gain an OpenCode tab with the confirmed steps. The command SHALL be the one the other tabs use (`node --env-file-if-exists=<.env> <src/mcp.ts>`, absolute paths).
4. **Example file.** When requirement 1(a) is confirmed, the repository SHALL ship an example OpenCode config at `opencode/opencode.example.json` (a folder of its own, as `codex/` is), with `.dockerignore` listing the folder as `codex` is. Its header comment, if the format allows comments, says where to put it.
5. **Where clients are named.** The following SHALL name OpenCode wherever they list Claude Code and Codex as the clients that use the tools: `README.md` (overview, comparison table, "MCP mode" line, guide link text); `docs/guide/*.md` (except the remote and phone cases of requirement 6); `site/index.html` (the "Claude Code or Codex" box, the map, the plan and notes captions); `.github/ISSUE_TEMPLATE/bug_report.md` (the Mode line); `docs/how-it-works.svg`; `docs/ENGINEERING.md` (the MCP-mode sentence and the `npm run mcp` row); `.env.example` comments. The README and `NOTICE.md` trademark lists SHALL name OpenCode.
6. **Remote and phone stay as they are.** Text about a remote HTTPS connection or the phone (README "From your phone", `site/index.html` "From your phone" box, `docs/guide/chat-on-your-phone.md`, `from-your-phone.md`, `phone-and-gps.md`, `several-riders.md`, `self-hosting.md`) SHALL keep naming Claude Code and Codex only. The `multi-user-server` purpose line is therefore not touched.
7. **No Claude-only claim for OpenCode.** Pages SHALL NOT say OpenCode has the `/mcp__ride__…` slash commands, `@ride:` attachments, forms, or Claude subagents as scouts; they say plain words work, unless confirmed in OpenCode's documentation.
8. **No behaviour change.** No file in `src/`, `scripts/` or `test/` and no file under `openspec/` SHALL change. Existing tests pass unchanged.

## Scenarios

### 1 and 2: the gate

- **WHEN** the design has confirmed a, b and c **THEN** the guide's OpenCode tab and the example file use exactly those keys and paths
- **EDGE: WHEN** c cannot be confirmed **THEN** the tab has no approval line and the rest ships
- **EDGE: WHEN** a cannot be confirmed **THEN** `opencode/` does not exist and the tab is the one-paragraph version

### 3: the page

- **WHEN** a link such as `.../guide/claude-code-and-codex` (README, outside pages) is opened **THEN** it still loads, now titled with OpenCode
- **WHEN** the guide is built **THEN** `several-riders.md`, `chat-on-your-phone.md` and the menu links resolve, with link text that may still say "Claude Code and Codex" only where requirement 6 applies

### 4: the example file

- **WHEN** a rider copies it where the header says, and the server command is the absolute path of this clone **THEN** it is a valid file of the format OpenCode documents (checked against the documentation, not by running OpenCode)
- **EDGE:** with no `.env` present the command still starts (`--env-file-if-exists`)

### 5: names

- **WHEN** `grep -ri codex` is run over the repository **THEN** every remaining hit is in the exceptions: Codex-specific content (`codex/`, `scripts/codex-register.ts`, `codex:register`, `~/.codex/config.toml`), requirement 6 files, `src/` strings, `docs/adr/`, `ROADMAP.md`, `CHANGELOG.md`, `CONTRIBUTING.md` and `commitlint.config.js` (history, scopes, product names), `AGENTS.md`/`CLAUDE.md` (they address coding agents, not riders), and `openspec/` requirement text

### 7: Claude-only claims

- **WHEN** a sentence describes slash commands, forms or attachments **THEN** it names Claude Code only

## Out of scope

- `src/` strings that list the clients (`capabilities.ts`, `admin.ts`, `rideServer.ts` comments, the generated reference): changing them changes what a rider sees from the app and would need a spec change. Left for a later request.
- An `npm run opencode:register` script.
- Remote or phone use of OpenCode, and the `multi-user-server` purpose line.
- Historical records: ADRs, CHANGELOG, ROADMAP.
- Renaming the page file or URL, a redirect, a new ADR.

## Conflicts with existing specs

None. `openspec/specs/mcp-server/spec.md` ("Client portability": any MCP client over stdio) already covers OpenCode; it is not edited and no OpenCode scenario is added, since none could be tested without OpenCode. `multi-user-server` is not touched. ADR 0004 and 0017 are not touched; ADR 0018 (guide with VitePress, clients side by side in code groups) is followed by adding a tab.

## Open questions

- The facts in requirement 1 (above); if any is unconfirmable the matching text is dropped (requirement 2). This cannot change the design beyond whether `opencode/` exists.
- Should a later request add OpenCode to the `src/` strings and the phone and remote pages? Left out; no decision needed now.
- Markdown lint: none run; Prettier is off for this folder and no other markdown linter is installed.
