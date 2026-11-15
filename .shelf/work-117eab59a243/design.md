# Design: OpenCode alongside Claude Code and Codex

Documentation only. No file in `src/`, `scripts/`, `test/` or `openspec/` changes.

## Result of the fact gate (requirement 1)

I read OpenCode's pages (`opencode.ai/docs/mcp-servers/`, `opencode.ai/docs/config/`) through a fetch tool that
returns a summary written by a small model, not the page text. It refused to copy the page verbatim and showed no
version or date. Its summaries also disagree with each other and with what I know of OpenCode (a `mcp.servers`
nesting, a `cwd` key, a top-level `permissions` array, "no `enabled` field"). A config written from them could be
wrong, and nobody can run OpenCode here to check it. So:

| Fact | State | Consequence (requirement 2) |
| --- | --- | --- |
| (a) config file name and stdio server keys | NOT confirmed | **No `opencode/opencode.example.json`, no `.dockerignore` line.** The tab is the one-paragraph version. |
| (b) project and user config locations | NOT confirmed | Nothing says where to copy a file. |
| (c) setting to avoid a confirmation per call | NOT confirmed | No approval advice. |

If a later pass can read the pages verbatim, requirement 4 (the example file) is the only thing to add; every other
edit below stays the same.

## Approach

Add the name where the clients are listed, and one tab in the connect code group. Reuse the existing text: the
server is a standard MCP stdio server (`mcp-server` spec, "Client portability"), so no behaviour or spec changes.
Follow ADR 0018 (clients side by side in code groups). No new ADR (spec: not needed). No openspec edit (spec: none,
requirement 8); a requirement could not be tested without OpenCode.

## Files touched

1. `docs/guide/claude-code-and-codex.md` (file name and URL kept)
   - Title: "Claude Code, Codex and OpenCode"; intro line names OpenCode.
   - Connect code group: new tab `[OpenCode]`, text only: the server is a standard stdio MCP server, started with
     `node --env-file-if-exists=<abs>/.env <abs>/src/mcp.ts` (the same command as the other tabs, absolute paths),
     register it as a local MCP server in OpenCode, see OpenCode's MCP documentation (link
     `https://opencode.ai/docs/mcp-servers/`). No file name, keys, paths or approval line.
   - Lines on slash commands, `@ride:` attachments, forms and subagents stay Claude Code only; the Codex notes stay.
     Add "plain words work in OpenCode" where those lines are (requirement 7).
2. VitePress menu entry (`docs/.vitepress/config.*`, the sidebar item for that page): text "Claude Code, Codex and OpenCode".
3. Other guide pages, `README.md`, `site/index.html`, `docs/ENGINEERING.md`, `.github/ISSUE_TEMPLATE/bug_report.md`:
   "Claude Code or Codex" becomes "Claude Code, Codex or OpenCode" (and "Claude Code and Codex" becomes "Claude Code,
   Codex and OpenCode") in the places of requirement 5. Code-group tab labels `[Claude Code / Codex]` become
   `[Claude Code / Codex / OpenCode]`: they are display labels only, and the same snippets apply since the user types plain words. Sentences
   that are Claude-only or Codex-only (slash commands, `codex -i`, `~/.codex`) are not touched.
   - README: overview, comparison table (row "What runs the agent": "any MCP client"; model row: add "OpenCode: the
     model you configure"), the MCP-mode line, the guide link text, the trademark list.
   - `docs/ENGINEERING.md`: line ~125 and the `npm run mcp` row.
   - `site/index.html`: the "Claude Code or Codex" box heading and text, map, plan and notes captions, line ~592. Not the
     "From your phone" box.
4. `docs/how-it-works.svg`: add the word OpenCode to its one Codex label; check the text still fits the box.
5. `NOTICE.md`: add OpenCode to the trademark list.

## Left as is (requirement 6 and out of scope)

Phone and remote text (README "From your phone" and "For several riders", `chat-on-your-phone.md`,
`from-your-phone.md`, `phone-and-gps.md`, `several-riders.md`, `self-hosting.md`, the site's phone box),
`docs/guide/reference.md`, `scripts/reference.ts`, `.env.example`, `src/` strings, ADRs, CHANGELOG, ROADMAP,
CONTRIBUTING, `commitlint.config.js`, `AGENTS.md`, `CLAUDE.md`, `openspec/`. Links to the page from these files
keep the old link text where requirement 6 applies.

## Errors and risks

- A wrong claim about OpenCode is the main risk; hence nothing beyond the command line and a link is stated.
- A wrongly claimed Claude-only feature: avoided by requirement 7.
- Broken links: the page path is unchanged; only link text changes.

## Testing

No code changes, so no unit tests. Checks:
- `npm run quality` (format check over docs and the site) passes.
- `npm run docs:build` (VitePress) resolves all links; if it is not available offline, say so in the PR.
- `grep -ri codex` over the repository: every remaining hit is in the exception list of the spec (scenario 5).
- `npm run spec:review -- --audit` for stale references.
- Markdown lint of this file: none run, no linter installed here.

## Alternatives rejected

- Ship `opencode/opencode.example.json` from memory or from the summaries: could be invalid; the spec forbids guessing.
- `npm run opencode:register`: out of scope, needs `scripts/`.
- Renaming the page or adding a redirect: breaks outside links for no gain.
- Editing `src/` client lists: changes what the app says, needs a spec change; left for a later request.
- An ADR or a spec scenario: no lasting decision, nothing testable.

## Outside facts

- OpenCode config file name and local server keys (command, arguments, environment): UNVERIFIED. Page tried:
  https://opencode.ai/docs/mcp-servers/ (the fetch tool gave only a paraphrase, no quotation, and a result I do
  not trust).
- OpenCode project and user config locations: UNVERIFIED. Page tried: https://opencode.ai/docs/config/ (same).
- OpenCode setting to skip confirmation per tool call: UNVERIFIED. Page tried: https://opencode.ai/docs/mcp-servers/.
- OpenCode is an MCP client that can start a local stdio server with a command: UNVERIFIED as a quotation; the
  paraphrase said "A local server is a command that OpenCode starts itself and talks to over the MCP stdio
  transport." The tab depends on this only in the generic sense and links to the docs.
- OpenCode docs link `https://opencode.ai/docs/mcp-servers/` exists: it loaded, but that is not a quotation. UNVERIFIED.
