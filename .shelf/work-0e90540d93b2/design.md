# Design: OpenCode as a supported client

## Approach

Documentation only, plus one spec scenario. The server is a stdio MCP server and already works with any such client (`mcp-server`, "Client portability"), so no `src/` change, no test, no new ADR (nothing hard to reverse; ADR 0004, 0017, 0021 are consistent and untouched).

Why not more: no `opencode:register` script and no shipped config file (spec section 5). The rider runs `opencode mcp add` and types four values, so there is no file layout to get wrong across OpenCode versions.

## Files touched

1. `openspec/specs/mcp-server/spec.md`: scenario "OpenCode" added under "Client portability" (done in this step, wording as in spec Req 6). No existing scenario changes; the Codex one stays.
2. `docs/guide/claude-code-and-codex.md` (same filename and URL): title "Claude Code, Codex and OpenCode", opening paragraph names it, and a third tab in the `code-group`:
   - `opencode mcp add` (add `--global` for every project), then the values: name `ride`, type local, command `node --env-file-if-exists=/abs/path/agent-motoride/.env /abs/path/agent-motoride/src/mcp.ts`, environment `RIDE_SCOUTS=0`. Tell the rider to replace `/abs/path`. Link https://opencode.ai/docs/mcp-servers/ for anything else.
   - A short paragraph: slash commands for the ride prompts, subagents and tool approval were not checked for OpenCode; plain words need nothing client-specific. "Plain words are enough, in both" becomes "in all three". The Codex-only sentences (approval key, `ride show 7`, no slash commands) stay.
3. `docs/guide/.vitepress/config.mts` (menu text) and `docs/guide/index.md` (tagline): name OpenCode; link `/claude-code-and-codex` unchanged.
4. Client lists, add "or OpenCode" / "Claude Code, Codex or OpenCode": `README.md` (lines found by `grep -n "Codex"`: overview, comparison table, the link text, the closing guide row), `site/index.html` (hero sentence, the middle "Three ways in" card heading and text, the "what can you say" captions and line ~592), and guide pages `getting-started.md` (incl. table header), `plan-a-ride.md`, `library.md`, `settings.md`, `limits.md`, `self-hosting.md`, `several-riders.md`, `sessions.md`, `everything.md`, `import-a-route.md`, `chat-on-your-phone.md` (the line about the client being the same server; the phone table row stays). Pass: `grep -rn "Codex"` over README, site, docs/guide, then judge each hit: a client list gets OpenCode, a Codex-only sentence does not. Where a sentence says slash commands exist "in Claude Code", leave it.
5. Unchanged on purpose: the site's "From your phone" card and `claude remote-control`; `docs/how-it-works.svg` and PNGs.
6. `scripts/reference.ts`: the comment (line 3), the heading `## Claude Code and Codex (MCP server)` (line 126) and the two sentences (lines ~174, 178) name OpenCode. Then `npm run docs:reference` regenerates `docs/guide/reference.md`; never hand-edit it. The heading renames an anchor: check `grep -rn "claude-code-and-codex-mcp-server" docs README.md site` and fix links if any. Text from `.env.example` ("scouts in Claude Code or Codex", `ANTHROPIC_API_KEY`) is changed at its source in `.env.example` only if it lists clients, then regenerate.

## Interfaces, data, errors

None. No new types, settings or tools. The only failure mode is a stale or broken link or a reference that differs from its source.

## Testing

- `npm run docs:reference`, then `git diff docs/guide/reference.md` shows only the OpenCode wording.
- `openspec validate --all` for the new scenario.
- `npm run quality` (format check covers the guide and README); the guide build (`docs:build` if present in `package.json`) to catch dead links.
- `npm run spec:review -- --audit` for stale references.
- No new automated test: the scenario rests on the existing "any MCP client over stdio" requirement and the existing end-to-end tests. OpenCode itself was not run; the PR says so.
- Markdown lint of this file: none run (Prettier is off for this folder; no other linter used).

## Alternatives rejected

- A `npm run opencode:register` script writing OpenCode's config: it would have to know the file layout and its per-version differences, which I could not confirm.
- A shipped `opencode.json` in the repo: same reason, and it would claim support we did not run.
- Renaming the page file to `mcp-clients.md`: breaks links from README, several-riders, chat-on-your-phone and older pages.
- Editing the SVG/PNG figure: no export script exists and a longer line may not fit.
- Stating OpenCode slash commands, subagents or approval behaviour: unconfirmed.

## Outside facts

- `opencode mcp add` takes `--global`: https://opencode.ai/docs/mcp-servers/ — "Add `--global` to make it available in every project:"
- Local server is a stdio command: https://opencode.ai/docs/mcp-servers/ — "A local server is a command that OpenCode starts over the MCP stdio transport."
- Type value: https://opencode.ai/docs/mcp-servers/ — "Must be `"local"`."
- Command value: https://opencode.ai/docs/mcp-servers/ — "Executable followed by its arguments."
- That `opencode mcp add` prompts for these four values (name, type, command, environment) in that form: UNVERIFIED (the page read showed `add` only for a remote server). The guide must word it as "the values to enter" and link the docs.
- Whether MCP prompts become slash commands, whether subagents run in parallel, how tool approval works, and `https://opencode.ai/docs/commands/`: UNVERIFIED, not read in this step.
