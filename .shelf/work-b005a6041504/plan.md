# Plan: OpenCode as a supported client

No `src/` change. The scenario in `openspec/specs/mcp-server/spec.md` ("OpenCode", under "Client portability") is already written; step 0 only checks it. Each step is one commit (`<type>(<scope>): ...`, no trailers), on the branch `shelf/work-b005a6041504`. Run `npm test` after steps 1 and 3 and `npm run quality` after each step that touches a formatted file.

## Order and risk

The riskiest step is the connection file (step 1): OpenCode cannot be run here, so a wrong key does nothing, silently. It goes first, with a drift test and a named manual check. The widest step is the doc sweep (step 4): the grep rule decides, so the check is a re-grep.

## Steps

### 0. Confirm the spec (no code)

- Files: none.
- Test: `openspec validate --all` parses the "OpenCode" scenario.

### 1. Drift test, then `opencode.json`

- Files: `test/opencode-config.test.ts` (new), `opencode.json` (new, root).
- Test first: with `node:test`, read `.mcp.json` and `opencode.json`. Assert `opencode.mcp.ride.command` deep-equals `[mcpServers.ride.command, ...mcpServers.ride.args]`, `type === "local"` and `enabled === true`. It fails (no file), then add:
  `{ "mcp": { "ride": { "type": "local", "command": ["node", "--env-file-if-exists=.env", "src/mcp.ts"], "enabled": true } } }`, 2-space indent, no `$schema`.
- Proof: `npm test`; `npm run format:check`.
- Commit: `feat(mcp): ship an opencode.json for the ride server`.
- Not provable here: that OpenCode accepts the keys. Carried to the pull request as "Not run in OpenCode".

### 2. Guide connection tabs and OpenCode section

- Files: `docs/guide/getting-started.md`, `docs/guide/claude-code-and-codex.md`.
- Test first: before editing, `grep -c "OpenCode"` on both files returns 0. After: each connect code group has an `OpenCode` tab (project file, plus a user-level `~/.config/opencode/opencode.json` snippet with absolute paths for `src/mcp.ts` and the `.env`). `claude-code-and-codex.md` gains one short "OpenCode" section: stdio MCP, the four hints, `planningGuide` before planning; approvals, subagents, slash commands and attachments are "check OpenCode's documentation". No statement of OpenCode behaviour. Title and heading name OpenCode; file name and address unchanged.
- Proof: `npm run docs:build` (tabs render, no dead links); `npm run format:check`.
- Commit: `docs(guide): connect OpenCode`.

### 3. Generator and `reference.md`

- Files: `scripts/reference.ts` (heading at line 126; the "Everything" intro at 174 and 178; line 140 stays Claude-only), `docs/guide/reference.md` (regenerated, never by hand).
- Test first: run `npm run docs:reference` on the untouched tree and confirm `git diff` is empty (the baseline). Edit the generator, regenerate.
- Proof: `git diff docs/guide/reference.md` shows only the heading and the intro; tool and prompt counts unchanged. If more changed, stop and look. Check whether a test or CI step compares the generated file (`grep -rn reference test .github`) and run it.
- Commit: `docs(guide): name OpenCode in the generated reference`.

### 4. The grep sweep: README, site, guide, config, notes

- Files: `README.md`, `site/index.html`, `docs/guide/.vitepress/config.mts` (menu text, site description; `link` unchanged), `docs/guide/*.md` (all pages, including `index.md`), `docs/ENGINEERING.md` (lines 125 and 794 only, the client lists), `NOTICE.md` line 36 and README line 210 (trademarks gain OpenCode), README "Model and effort" row becomes "The MCP client's own model".
- Test first: save the hit list before editing:
  `grep -rn "Claude Code\|Codex" README.md site/index.html docs/guide scripts/reference.ts --include=* --exclude-dir=node_modules --exclude-dir=dist`.
  Classify each hit **in** (a list of MCP clients) or **out** (the exceptions in design.md: phone, remote control, multi-user HTTPS; `codex:register`, the Codex tab; slash commands, `@` attachments, subagent scouts; the pages and notes design.md leaves alone). Write the classification in the pull request body.
- Change only **in** hits to "Claude Code, Codex or OpenCode" ("and" where the sentence has "and"). The tab label `[Claude Code / Codex]` becomes `[Claude Code / Codex / OpenCode]` in every occurrence, one identical label for VitePress tab sync (`sed` over `docs/guide/*.md`, covering the nine pages found plus any that grep finds).
- Proof:
  - `grep -rn "Claude Code / Codex\]" docs/guide` finds nothing.
  - Re-grep: every remaining hit is **out**.
  - `git diff` has no hunk inside an exception (README lines about phone and remote control, the phone card in `site/index.html`, the `from-your-phone`, `chat-on-your-phone` and `several-riders` pages, the slash-command lines, the scouts claims).
  - `npm run docs:build`; `npm run format:check`.
- Split the commit if large: README and site (`docs(readme): ...`), guide pages and config (`docs(guide): ...`), notes (`docs(engineering): ...`, `docs(notice): ...`).
- Hits that look like client lists but stay (for example `site/index.html` 496 and 564, README 150 and 158) are listed with a reason in the pull request body.

### 5. Final checks and pull request

- `npm run quality` (typecheck, lint, format check, tests with coverage).
- `openspec validate --all`.
- `npm run spec:review -- --base origin/main --head HEAD`, then `-- --audit`.
- `npm run docs:build`.
- Pull request from the template: summary; spec touched (`mcp-server`, "Client portability"); verified (the commands above); not verified: "Not run in OpenCode: `opencode` started in the project folder lists the ride tools; the user-level snippet and its path `~/.config/opencode/opencode.json` are unchecked. A wrong key is a one-file fix plus the guide snippet." Add the list of **out** hits that look like client lists.
- `ROADMAP.md`, `openspec/code-map.json`, `CHANGELOG.md` unchanged (release automation owns the changelog).

## Assumptions

- Follows `design.md` where it differs from `spec.md` (wider requirement 4, narrowed requirements 3 and 5, drift test, generator and `reference.md` and `NOTICE.md` included).
- The OpenCode config keys and the user-level path are from memory and checked by the reviewer.
- Commits are grouped as above; the maintainer may squash.
- The `.shelf/` entry in `.prettierignore` stays on the branch.
- The test is a plain `node:test` file; the repository's test conventions (`test/` folder, `.ts` with `node:test`) were read and followed.

## Conflicts with existing specs or ADRs

None. `mcp-server` "Client portability" gets one scenario and its requirement text is unchanged. ADR 0004 and ADR 0017 hold.

## Formatting check

No markdown linter available for this file, and Prettier is off for the folder; not run.
