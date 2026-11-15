# Design: OpenCode as a third MCP client

## Approach

Documentation and one config file. The stdio MCP server is client-neutral (ADR 0004, `mcp-server` "Client portability"), so OpenCode needs no code. No `src/` change, so no `no-spec` label; the spec gets a scenario instead.

## Files touched

- `opencode.json` (new, repo root): registers `ride` as a `local` MCP server with command `node --env-file-if-exists=.env src/mcp.ts`, the counterpart of `.mcp.json`. OpenCode reads it from the project directory.
- `openspec/specs/mcp-server/spec.md`: new scenario "OpenCode" under "Client portability". No requirement text changes.
- `docs/guide/claude-code-and-codex.md`: title "Claude Code, Codex and OpenCode"; add an `[OpenCode]` tab to the connect code group (project file, plus a user-level snippet for `~/.config/opencode/opencode.json` with absolute paths); a short "what differs" note: tool approval is OpenCode's own setting (permission config), plain words work, slash commands (`/mcp__ride__*`), `@ride:` attachments, subagent scouts and elicitation forms are listed for Claude Code only (unchecked in OpenCode); without subagents the model explores areas itself, as the page already says for Codex.
- The page path `/claude-code-and-codex` is **kept** (README, `several-riders.md`, `chat-on-your-phone.md` and external links point to it); only the title and link text change. No redirect needed. Sidebar entry in `docs/guide/.vitepress/config.mts` renamed.
- Name OpenCode next to Claude Code and Codex in: `README.md` (overview, comparison table, client list, trademarks line, guide link text), `docs/guide/index.md`, `getting-started.md` (table header, code group tab, "what can you do" lines), and the other guide pages that list the clients (grep "Codex" in `docs/guide/`), except `from-your-phone.md`/`chat-on-your-phone.md` text about the Claude and ChatGPT apps (Requirement 5).
- `site/index.html`: every "Claude Code or Codex" that is about using the tools (lines ~351, 365, 444, 522 card title, 592) becomes "Claude Code, Codex or OpenCode". Line ~528 ("From your phone") is left alone.
- `NOTICE.md`: add OpenCode to the trademark list.
- `ROADMAP.md`: no change unless an item mentions it.
- `docs/guide/reference.md` is generated: run `npm run docs:reference` only if the script output changes (it should not; no tools changed).

## Interfaces and errors

None added. If the rider starts OpenCode outside the project directory, the relative path fails; the guide points to the user-level registration with absolute paths, as for the other two.

## Testing

No behaviour test (docs text is out of scope). Run `npm run quality`, `openspec validate --all`, and the guide build (`vitepress build`) to catch broken links and the Prettier check on the edited Markdown/JSON. The config shape was written from memory of OpenCode's documented format and could not be run here (no OpenCode, no network).

## Alternatives rejected

- New page `opencode.md`: duplicates the connect/talk/scouts text; a third tab in the existing page is smaller.
- Renaming the page path with a redirect: breaks links for no gain.
- `npm run opencode:register` script: out of scope; a snippet suffices.
- OpenCode-specific prompts/agents: contradicts ADR 0004.

## Decision record

None: nothing here is expensive to reverse.

## Assumptions

- "Support" = the existing stdio server works in OpenCode and the docs say how; no server change.
- `opencode.json` format (`mcp.<name>` with `type: "local"`, `command` array, `enabled`) and the user config path `~/.config/opencode/opencode.json` are as I remember them; to verify against OpenCode's docs before merge.
- OpenCode is added next to Claude Code and Codex, not replacing them.
- Phone/remote-control and hosted HTTPS (OAuth) text does not claim OpenCode.
- Claude Code-only features are not claimed for OpenCode (unchecked).
- Page path is kept; only title and sidebar text change.
