# Plan: OpenCode alongside Claude Code and Codex

Documentation and one example config. No file in `src/`, `scripts/`, `test/` or `openspec/` changes (spec req. 8), so
there is no unit test to write first. "Test first" here means: each step starts by writing the check that proves it
(a grep or a script from the design's Testing list), seeing it fail, then editing. No existing spec or ADR is
contradicted: `mcp-server` "Client portability" already covers any stdio client, and ADR 0018 (clients side by side
in code groups) is followed by adding a tab.

Branch: `docs/opencode-client`. One commit per step, type `docs` (step 1 also `docs`; `.dockerignore` rides with it).
No spec file is touched, so the PR needs no `no-spec` label for `src/` (it changes none).

Gate for every step: `npm run format:check` (covers JSON, HTML, markdown outside `.shelf/`). Fix with `npm run format`.

## Step 1. Example config (riskiest: the only new artifact, and its keys come from the fact gate)

- Files: `opencode/opencode.example.json` (new), `.dockerignore` (add `opencode` after `codex`).
- Content exactly as in design.md "Files touched" 1: `$schema`, `mcp.ride` with `type: "local"`, `command` array
  (`node`, `--env-file-if-exists=/abs/path/agent-motoride/.env`, `/abs/path/agent-motoride/src/mcp.ts`),
  `enabled: true`, `environment: { "RIDE_SCOUTS": "0" }`. No approval key (fact (c) not confirmed).
- Test first: write the check from design Testing 2 (parse the JSON; assert keys are exactly `$schema` and
  `mcp.ride.type|command|enabled|environment`). It fails (no file), then create the file and it passes. Also confirm
  `RIDE_SCOUTS` is a real setting (`grep -rn RIDE_SCOUTS src/ codex/`) and matches `codex/config.example.toml`.
- Proof: the check passes; `npm run format:check` passes on the file.

## Step 2. The guide page and its menu entry

- Files: `docs/guide/claude-code-and-codex.md` (name and URL kept), `docs/guide/.vitepress/config.mts` line 38.
- Test first: `npm run docs:build` baseline (record whether it runs offline); then
  `git grep -n OpenCode docs/guide/claude-code-and-codex.md docs/guide/.vitepress/config.mts` prints nothing.
- Edit: title "Claude Code, Codex and OpenCode"; intro names OpenCode; add an `[OpenCode]` tab to the connect group:
  copy `opencode/opencode.example.json` to `opencode.json` in a project root, or merge its `mcp` entry into
  `~/.config/opencode/opencode.json`; replace `/abs/path/agent-motoride` with this clone's path; start `opencode`, ask
  in plain words; say "OpenCode 1.x"; link `https://opencode.ai/docs/mcp-servers/`. No approval line. Where the Codex
  note says plain words work, add OpenCode. Lines on `/mcp__ride__…`, `@ride:`, forms and Claude subagents stay Claude
  Code only (req. 7). Menu `text` becomes "Claude Code, Codex and OpenCode"; `link` unchanged.
- Proof: the grep now matches; `npm run docs:build` succeeds (or the PR says it could not run offline).

## Step 3. Getting-started tab and the 24 plain-words tab labels

- Files: `docs/guide/getting-started.md` (new `[OpenCode]` tab, short form: file to copy plus link to the guide page,
  and its line 80 label), then the labels at `import-a-route.md:17`; `library.md:20, 51, 78, 103, 132, 153, 228, 250,
  276`; `notes-and-review.md:23, 46, 106`; `phone-and-gps.md:43, 128, 164, 189, 219`; `plan-a-ride.md:75`;
  `settings.md:71, 102, 125`; `stops-and-bike.md:18`.
- Unchanged on purpose: `notes-and-review.md:79` (form), `plan-a-ride.md:18` (slash command), `from-a-photo.md:15`
  (`codex -i`).
- Test first: run the design Testing 5 awk loop now (it must print nothing: no label ends in `/ OpenCode]` yet, so
  also `git grep -c "Claude Code / Codex / OpenCode\]" docs` prints 0 and the count of `Claude Code / Codex]` is 27).
- Edit: relabel the 24 blocks to `[Claude Code / Codex / OpenCode]`. If a block holds a client-specific line, leave its
  label and note it in the PR.
- Proof: label count is 24 new and 3 old; the awk loop still prints nothing; `docs:build` passes. Line numbers may
  have shifted after step 2 and the getting-started edit: locate by grep, not by number.

## Step 4. Client names in the remaining guide prose

- Files: `docs/guide/*.md` outside the exceptions: `everything.md`, `index.md`, `limits.md`, `sessions.md`,
  `settings.md`, `library.md`, `import-a-route.md`, `notes-and-review.md`, `plan-a-ride.md`, `stops-and-bike.md`,
  `getting-started.md`, `from-a-photo.md` (the prose, not the `codex -i` line). Not touched: `reference.md`,
  `chat-on-your-phone.md`, `from-your-phone.md`, `phone-and-gps.md` prose, `several-riders.md`, `self-hosting.md`.
- Test first: the design Testing 4 grep; copy its output as the to-do list (every line not Codex-specific and not
  phone/remote).
- Edit: "Claude Code or Codex" becomes "Claude Code, Codex or OpenCode" where the line lists clients that use the tools
  locally. Sentences on slash commands, forms, attachments stay Claude Code only.
- Proof: the grep's remaining lines are Codex-specific or requirement 6 only; `docs:build` passes.

## Step 5. README, NOTICE, issue template, ENGINEERING

- Files: `README.md` (lines about 32, 51, 52, 53, 59 if it is the MCP line, 111, 129, 132, 158, 197, 210, 223),
  `NOTICE.md:36`, `.github/ISSUE_TEMPLATE/bug_report.md:13`, `docs/ENGINEERING.md` (about 125 and the `npm run mcp` row
  at about 794).
- Test first: `git grep -n -i opencode -- README.md NOTICE.md .github docs/ENGINEERING.md` prints nothing.
- Edit: name OpenCode in the client lists; trademark lists gain "OpenCode"; guide link text becomes
  "Claude Code, Codex and OpenCode". Comparison table: row 55 (model) and row 52 (pay with) get no OpenCode claim
  (design). Row 51 and 53 name it. Leave README about 62 (several riders), 73 (phone) as they are. Keep the README
  table aligned (Prettier reformats it; run `npm run format`). `ENGINEERING.md` harness diagrams need no change (no flow
  changes); only the sentence and the table row.
- Proof: grep matches only the intended lines; `npm run format:check` passes.

## Step 6. The website

- Files: `site/index.html` (about lines 365, 444, 522, 592, and the map and plan captions found by grep).
- Test first: `git grep -n -i opencode site/index.html` prints nothing.
- Edit: the "Claude Code or Codex" box becomes "Claude Code, Codex or OpenCode" with a line saying plain words work
  there; captions that list clients gain OpenCode. Line 444 mentions `/mcp__ride__note`: keep that part Claude Code only
  and add OpenCode only to the plain-words half. Leave the phone box (about 528) alone. Check the heading still fits
  its card (look at the CSS; a long `h3` may wrap). Pages are published by `.github/workflows/pages.yml`; no workflow
  change.
- Proof: grep matches; `npm run format:check`; no phone-box line changed (`git diff` read).

## Step 7. The diagram

- Files: `docs/how-it-works.svg` line about 148.
- Test first: the awk length rule over the changed `<text>` lines (each at most 31 characters) fails on a deliberately
  too-long draft; then use the design's two lines: "Claude Code, Codex or OpenCode" (30) and "use the same tools, your plan"
  (29), kept inside the box (two body lines, y=58 and y=78). No SVG renderer is installed: the length rule is the check
  and the PR says it was not rendered.
- Proof: both lines at most 31 characters; the SVG still parses (`node -e` with a basic XML check, or Prettier if it
  formats SVG, else say so).

## Step 8. Whole-change verification

- Run, and report which ran: `npm run quality`; `npm run docs:build`; the design Testing 4 grep (remaining hits only
  Codex-specific or requirement 6); Testing 5 awk loop (prints nothing); `npm run spec:review -- --audit`;
  `git diff --stat main` shows nothing under `src/`, `scripts/`, `test/`, `openspec/`.
- PR body from the template: summary; spec touched: none (documentation, `mcp-server` Client portability already
  covers it); verified: the list above; not verified: OpenCode was not run (the example matches the v1 documentation
  source, 1.19.5, read via `curl`; the rendered docs site was refused by the sandbox), no approval advice because
  fact (c) is not confirmed, the SVG was not rendered, OpenCode 2.x uses `mcp.servers` and is not covered. Add a
  `ROADMAP.md` line only if it already lists OpenCode (it does not, per grep: leave it).

## Risks

- Example file shape is only checked against documentation; the guide says "OpenCode 1.x".
- Over-claiming parity: every changed sentence is re-read against requirement 7 in steps 3, 4 and 6.
- Line numbers in this plan come from the current tree and move as steps land: always locate by grep.

Markdown lint of this file: none run; Prettier is off for this folder and no other markdown linter is installed.
