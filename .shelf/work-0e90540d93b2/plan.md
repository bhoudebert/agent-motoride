# Plan: OpenCode as a supported client

Documentation only plus one spec scenario. No `src/` change, so there is no unit test to write first. The "test" of each step is a command that must show the expected result, and it is run before the edit (to see the gap) and after it (to see it closed). The spec scenario "OpenCode" is already in `openspec/specs/mcp-server/spec.md` (line ~106), written by the design step.

Hit counts from `grep -c Codex` (for judging each hit; a client list gets OpenCode, a Codex-only sentence does not): README 16, site/index.html 6, guide pages: claude-code-and-codex 10, library 12, getting-started 7, from-your-phone 6, settings 6, phone-and-gps 5, plan-a-ride 4, several-riders 4, notes-and-review 4, and 1–2 in chat-on-your-phone, everything, from-a-photo, import-a-route, index, limits, self-hosting, sessions, stops-and-bike. Reference: `scripts/reference.ts` 4, `.env.example` 2, `docs/guide/reference.md` 3 (generated).

Commit scopes follow Conventional Commits (`docs(guide)`, `docs(readme)`, `docs(site)`, `docs(reference)`); each step is one commit.

## Step 1. Riskiest: the reference source and its anchor

The generated reference is the only part where a hand edit would be wrong and a rename can break links.

- Files: `scripts/reference.ts` (comment line 3, heading `## Claude Code and Codex (MCP server)` line ~126, two sentences ~174 and ~178), `.env.example` (only if the "scouts in Claude Code or Codex" text lists clients; change it at its source), `docs/guide/reference.md` (regenerated, never hand-edited).
- Test first: `grep -rn "claude-code-and-codex-mcp-server" docs README.md site` to list every link to the old anchor; note the result before editing.
- Edit the source, run `npm run docs:reference`.
- Proof: `git diff docs/guide/reference.md` shows only OpenCode wording; running `npm run docs:reference` again gives no further diff; every link found by the grep points at the new anchor (fix those in this commit).

## Step 2. The connect page: OpenCode tab

- File: `docs/guide/claude-code-and-codex.md` (same filename and URL).
- Test first: `grep -ci opencode docs/guide/claude-code-and-codex.md` returns 0.
- Edit: title "Claude Code, Codex and OpenCode", opening paragraph, third tab in the `code-group` with `opencode mcp add` (and `--global`), the values name `ride`, type local, command `node --env-file-if-exists=/abs/path/agent-motoride/.env /abs/path/agent-motoride/src/mcp.ts`, environment `RIDE_SCOUTS=0`, the "replace `/abs/path`" note and the link https://opencode.ai/docs/mcp-servers/. Add the paragraph saying slash commands for the ride prompts, subagents and tool approval were not checked for OpenCode and that plain words are the way in. "Plain words are enough, in both" becomes "in all three". Codex-only sentences stay. No config-file layout, no claim about OpenCode behaviour beyond the spec's section 2.
- Proof: grep now finds `opencode mcp add`, the four values and the docs link; `grep -in "slash\|subagent\|approv" ` on the new text shows only "not checked" wording for OpenCode.

## Step 3. Menu and home tagline

- Files: `docs/guide/.vitepress/config.mts` (menu text), `docs/guide/index.md` (tagline).
- Test first: `grep -n "Codex" docs/guide/.vitepress/config.mts docs/guide/index.md` shows both without OpenCode.
- Edit: name OpenCode; the link `/claude-code-and-codex` is unchanged.
- Proof: grep shows OpenCode in both; `npm run docs:build` succeeds (no dead links).

## Step 4. Guide pages that list clients

- Files: `getting-started.md` (including the comparison table header), `plan-a-ride.md`, `library.md`, `settings.md`, `limits.md`, `self-hosting.md`, `several-riders.md`, `sessions.md`, `everything.md`, `import-a-route.md`, `chat-on-your-phone.md` (only the line saying the client is the same server; the phone table row stays), plus any other page where `grep -n "Codex" docs/guide/*.md` finds a client list (check `from-a-photo`, `from-your-phone`, `notes-and-review`, `phone-and-gps`, `stops-and-bike` and judge each hit; phone lines stay).
- Test first: `grep -rn "Claude Code or Codex\|Claude Code and Codex" docs/guide --include=*.md` (excluding `reference.md`, already done in step 1) lists the hits to change.
- Edit: "Claude Code, Codex or OpenCode" where a sentence lists MCP clients. Leave Codex-only sentences (registration, approval key, `ride show 7`, no slash commands) and "slash commands exist in Claude Code" sentences.
- Proof: the same grep returns only Codex-only sentences and phone sentences; `npm run docs:build` passes; Prettier check on these files passes (`npm run format:check`).

## Step 5. README

- File: `README.md` (overview, comparison table, link text, closing guide row; judge each of the 16 Codex hits).
- Test first: `grep -n "Codex" README.md`.
- Edit: add OpenCode to client lists. The figure `docs/how-it-works.svg` and its PNG stay (spec section 5), so the README's image alt text is not changed to claim OpenCode appears in it.
- Proof: grep shows no client list naming only two; links to `/claude-code-and-codex` still resolve (page name unchanged).

## Step 6. Website

- File: `site/index.html` (hero sentence, the "Three ways in" middle card heading "Claude Code or Codex" and its text, the "what can you say" captions, the line near 592).
- Test first: `grep -n "Codex" site/index.html` (6 hits).
- Edit: the middle card heading and text name OpenCode; the "From your phone" card and `claude remote-control` stay exactly as they are.
- Proof: grep shows the phone card unchanged (`git diff site/index.html` does not touch it); open the file's section by reading it, since no site test exists.

## Step 7. Whole-repository check

- Commands, in this order: `openspec validate --all` (the new scenario parses), `npm run docs:reference` (no diff), `npm run docs:build` (no dead links), `npm run spec:review -- --audit` (no stale references), `npm run quality`.
- Proof: all green. If a command is not runnable here (no network, missing nix), say so in the PR instead of claiming it passed.
- Final grep: `grep -rn "Claude Code or Codex\|Claude Code and Codex" README.md site docs/guide scripts .env.example` returns only the phone card, the Codex-only sentences, and nothing else.

## Pull request

Branch `docs/opencode-support`. Template: summary; spec touched (`mcp-server`, scenario "OpenCode"); verified (the commands of step 7); not verified (OpenCode itself was never run, and its slash commands, subagents, approval and whether `opencode mcp add` prompts for environment variables are unchecked; the figure is unchanged on purpose). `ROADMAP.md`: add nothing unless an OpenCode idea is already listed there (check with `grep -in opencode ROADMAP.md` in step 5). No attribution trailers.

## Not in this plan

A register script, a shipped OpenCode config, any code or test change, the SVG/PNG figure, OpenCode on the phone or against the hosted server.

Markdown lint of this file: none run (Prettier is off for this folder; no other linter used).
