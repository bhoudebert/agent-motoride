# Design: OpenCode alongside Claude Code and Codex

## Approach

Documentation, one config example and one spec scenario. No change in `src/`: the stdio MCP server already works with any client (`mcp-server`, "Client portability"). Rejected: an `opencode:register` script (OpenCode reads a project-level `opencode.json`, so a copy-paste example suffices); a new ADR (nothing lasting is decided; ADR 0004 and 0017 are untouched).

## Files touched

- `openspec/specs/mcp-server/spec.md`: new scenario "OpenCode" under "Client portability" (already written, requirement text unchanged).
- `opencode/opencode.example.json` (new, beside `codex/`): `{"$schema": "https://opencode.ai/config.json", "mcp": {"ride": {"type": "local", "command": ["node", "--env-file-if-exists=/abs/path/agent-motoride/.env", "/abs/path/agent-motoride/src/mcp.ts"], "enabled": true, "environment": {"RIDE_SCOUTS": "0"}}}}`. A header cannot live in JSON, so the guide says to replace `/abs/path`. Check that the `codex/` folder is not enumerated by a packaging or spec-review file list (grep `codex/` in `package.json`, `openspec/code-map.json`, Dockerfile) and mirror it for `opencode/` if so.
- `docs/guide/claude-code-and-codex.md`: keep the file name (stable URLs). Change the H1 and title to "Claude Code, Codex and OpenCode"; add an `[OpenCode]` code-group tab (copy the example to `opencode.json` in the project or `~/.config/opencode/opencode.json`); an approval note (OpenCode's `permission` setting, only if it asks; wording kept hedged); a line that slash commands, `@` attachments and forms are Claude Code only; widen "both" / "Claude Code or Codex" in the text.
- `docs/guide/.vitepress/config.mts:38`: sidebar text "Claude Code, Codex and OpenCode", same link.
- Link texts `[Claude Code and Codex](/claude-code-and-codex)` in `several-riders.md`, `chat-on-your-phone.md`, README:111 and :139: rename the text.
- Every other `docs/guide/*.md` (about 15 files) and `README.md` (lines 32, 51-53, 62, 132, 158, 223), `site/index.html` (351, 365, 444, 522 card heading, 592): add OpenCode where "Claude Code or Codex" names MCP-mode clients. Do not widen: `site/index.html:528` and README:73 (phone), slash command and form mentions.
- `scripts/reference.ts` (126, 174, 178) and `.env.example` (4, 74): widen wording, then run `npm run docs:reference` so `docs/guide/reference.md` and `everything.md` match. `src/capabilities.ts:13` and `src/admin.ts:37` are code comments: leave (no `src/` change).
- `docs/how-it-works.svg:148` is a diagram label; widen only if the text fits, otherwise leave and note it. `docs/ENGINEERING.md`, `ROADMAP.md`: add OpenCode where they list clients.
- `multi-user-server` Purpose: left as is (HTTPS for OpenCode not claimed).

## Errors and edge cases

Placeholder path left in place: the guide says to replace it, as for Codex. Old links keep working because the file name is unchanged.

## Testing

`grep -rn "Claude Code or Codex"` and `"Claude Code and Codex"` afterwards: each remaining hit is a Claude-only or phone case. Validate the example with `node -e "JSON.parse(...)"`. Run `npm run docs:reference`, `openspec validate --all`, `npm run quality`, and the guide build if available (dead-link check). The doc-text tests, if any, may assert the old strings: fix them with the change.

## Assumptions

- OpenCode's `opencode.json` format (`mcp.<name>` with `type: "local"`, `command` array, `environment`) is from memory and unverified, since OpenCode cannot be run here; the maintainer should try it once. Only the example and the guide tab would change.
- "Support" means the existing MCP server, nothing more; no approval-mode claim beyond a hedged note.
- Phone remote control, slash commands, `@` attachments and forms are not claimed for OpenCode.
- No ADR: the decision is cheap to reverse.
