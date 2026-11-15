# Plan: OpenCode as a third MCP client

No `src/` behaviour changes. Each step is a small commit (Conventional Commits, branch `docs/opencode-client`). There is no unit test for OpenCode (spec: out of scope), so "test first" here means: the check that proves the step is named and run before or right after the edit. The generated-page check is the one real test (step 2).

Already done in the architect step: the `OpenCode` scenario in `openspec/specs/mcp-server/spec.md` (requirement 5). Do not redo it; `openspec validate --all` must still pass.

## Step 1 (riskiest): verify OpenCode's real config, then ship `opencode.json`

The format is the only unchecked fact everything else rests on.

- Fetch OpenCode's own docs (opencode.ai/docs, MCP servers and config pages) with WebFetch. Confirm: file name `opencode.json` in the project root, the `mcp.<name>` entry with `type: "local"`, `command` as an array, `enabled`, the `$schema` URL, and whether the command runs from the project directory (relative `src/mcp.ts` valid). Also record, from the docs only: the key for tool approval (`permission`), whether MCP prompts become slash commands, whether subagents exist.
- If the docs differ from the design, the docs win; note the change in the PR.
- Proof first: `node --env-file-if-exists=.env src/mcp.ts` is the same command as `.mcp.json`; run `npm run mcp:smoke` to show the server works over stdio, and parse the new file with `node -e "JSON.parse(require('fs').readFileSync('opencode.json','utf8'))"`.
- Files: `opencode.json` (new); `.dockerignore` only if it lists `.mcp.json` (today it lists `codex`, not `.mcp.json`: so likely nothing).
- Commit: `feat(mcp): ship an opencode.json that registers the ride server`.

If the docs cannot be reached, ship the file from the design and mark every OpenCode statement in the guide "format taken from the OpenCode docs, not run here" (design, "Honesty").

## Step 2: generated pages first (they bind the rest)

- Test first: run `npm run docs:reference` on a clean tree; confirm no diff (baseline). Then edit `scripts/reference.ts` (heading `## Claude Code and Codex (MCP server)` at line 126, the `everything` intro at lines 174 and 178, the header comment at line 3) to name OpenCode, and `src/capabilities.ts:13` comment ("What to say in Claude Code, Codex or OpenCode"; wording only).
- Run `npm run docs:reference`; commit the regenerated `docs/guide/reference.md` and `everything.md`. Never hand-edit them. If a link anchor to the old heading exists (grep `#claude-code-and-codex` in `docs/`), update it.
- Check: `npm run docs:reference` again gives no further diff; the documentation check (the reference and catalogue-driven page test under `test/`) passes with `npm test`.
- Commit: `docs(guide): name OpenCode in the generated reference`.

## Step 3: the MCP client guide page

- Files: `docs/guide/claude-code-and-codex.md` (keep the file name; title becomes "Claude Code, Codex and OpenCode"), `docs/guide/.vitepress/config.mts:38` (sidebar text only; link unchanged).
- Add an `[OpenCode]` tab to the Connect code-group: starting `opencode` in the project (the shipped file), and the same entry with absolute paths for `~/.config/opencode/opencode.json`. Add how to check: list MCP servers in OpenCode; `npm run mcp:smoke` to test the server itself.
- Differences, only what step 1 verified: approval of tool calls (use the real key from the docs, or "not checked"), slash commands for prompts ("not checked" if unconfirmed), scouts (the model explores the areas itself, as for Codex; no promise of parallel scouts), the `ride show 7` shell-command caveat only if observed.
- Check: `npm run docs:build` (no dead links); a grep that the page contains no claim marked verified that step 1 did not verify.
- Commit: `docs(guide): connect OpenCode in the MCP client page`.

## Step 4: wording sweep in the guide

- Replace "Claude Code or Codex" by "Claude Code, Codex or OpenCode" (and "Claude Code and Codex" by "Claude Code, Codex and OpenCode") in `docs/guide/`: `index.md` (tagline), `getting-started.md` (table header and the "Who thinks" row, lines 8, 10, 32, 66, 87), `plan-a-ride.md` (85, 102), `library.md` (60, 200), `limits.md` (68), `self-hosting.md` (14), `several-riders.md` (5, 37), `settings.md` (11), and the remaining files the grep lists (`everything`, `others`, `reference` are generated or covered by step 2). Re-run the grep from the repository root to get the full list, since the earlier output was truncated.
- Tab labels `[Claude Code / Codex]` (many code blocks): leave as they are. The prompts are plain words that work in OpenCode, but the label is a tab key shared across pages; renaming all of them is churn with a risk of breaking tab sync. Only the two tab groups in `getting-started.md` (line 80) and the Connect group change if they hold OpenCode-specific text. Write this choice in the PR.
- Check: `npm run docs:build`; `npm run format:check`.
- Commit: `docs(guide): name OpenCode wherever the guide names the MCP clients`.

## Step 5: README, ROADMAP, ENGINEERING, small files

- Files: `README.md` (lines 32, 51, 52, 53, 62, 73, 111, 132, 158, 197, 223, the comparison table row "What runs the agent", and the trademark note: find it by grepping "trademark" or "Anthropic" near the end), `docs/ENGINEERING.md` (125, 794), `NOTICE.md` (trademark mention), `.github/ISSUE_TEMPLATE/bug_report.md:13`, `.env.example` (lines 4, 74; comments only), `docs/how-it-works.svg:148` (one text line; keep it within the box width, or reflow the two lines), `ROADMAP.md` (lines 163, 171 are history; only add an "OpenCode supported" mention if the roadmap lists clients as an idea, else leave).
- `src/admin.ts:37` doc comment: comment only; the printed connection text is unchanged. `src/oauth.ts`, `src/server.ts`, `src/tenants.ts` comments: leave (they describe the bearer token, not the client list).
- Do not edit `CHANGELOG.md` (generated by release) or the ADRs (history; ADR 0004 names "Claude Code, Codex" as a fact of its day).
- `docs/ENGINEERING.md` has no architecture change, so its diagrams stay.
- Commit: `docs(readme): name OpenCode next to Claude Code and Codex`.

## Step 6: the website

- File: `site/index.html` lines 351, 365, 444, 522, 528, 592. Lines 351, 365, 444, 592 take the three-client wording. The card at 522 (`<h3>Claude Code or Codex</h3>`) becomes "Claude Code, Codex or OpenCode"; keep it a single card (no new card, no new styling). Line 528 (phone, driven from the Claude or ChatGPT app) names the session; add OpenCode only if the sentence stays true (a session on a VPS driven from a phone app applies to Claude and Codex; for OpenCode this is unchecked, so leave 528 as "Claude Code or Codex session" and say so in the PR).
- Check: open the file for stray markup (`npx prettier --check site/index.html` if the repository's format check covers `site/`), and `npm run docs:build` if `pages.yml` builds the site with the guide; read `.github/workflows/pages.yml` to see what it publishes.
- Commit: `docs(site): say OpenCode works alongside Claude Code and Codex`.

## Step 7 (optional, skip if not trivial): `npm run check` line

- `src/check.ts:43-47` prints a `.mcp.json` line. Add the same style of line for `opencode.json` only if it is a few lines and a test covers `check` output today; otherwise skip (design, step 6). If done: test first in the existing check test, then the code, and the spec of `cli` or `mcp-server` may need a word (a rider notices a new line: behaviour, so no `no-spec`).
- Default decision: skip.

## Step 8: the gate

- `npm run docs:reference` (no diff), `npm run docs:build`, `openspec validate --all`, `npm run spec:review -- --audit` (stale references and code map), `npm run quality`.
- `openspec/code-map.json`: no new `src/` symbol, so no change.
- Pull request from the template: summary, spec touched (`mcp-server`, "Client portability"), what was verified (the docs, `mcp:smoke`, the checks above), and what was not (OpenCode itself was not run here; unchecked statements listed). If `src/` changed only by comments (`src/admin.ts`, `src/capabilities.ts`): the spec file is already in the PR; if the spec gate still complains, the `no-spec` label with reason "comment wording only". No attribution trailers beyond what the commit hook allows (AGENTS.md rule 8 says none; follow the repository rule over the default footer).

## Assumptions

- The OpenCode project config is `opencode.json` with an `mcp.ride` entry of `type: "local"`; step 1 confirms or corrects this from OpenCode's own docs.
- OpenCode belongs to the MCP mode; the CLI mode and the server are untouched.
- The guide file name stays `claude-code-and-codex.md` so published links and README links stay valid.
- Tab labels `[Claude Code / Codex]` are kept; only prose and titles change.
- No ADR, no register script, no CI test for OpenCode, no new site card.
- Phone-driven session text (README line 73, site line 528) is left to Claude Code or Codex unless verified for OpenCode.
- Formatting: no linter was run on this file (Prettier is off for this folder by design; none other was tried).

## Conflicts with existing specs or ADRs

None. `mcp-server` "Client portability" says "any MCP client"; the OpenCode scenario is additive. ADR 0004 and ADR 0017 hold.
