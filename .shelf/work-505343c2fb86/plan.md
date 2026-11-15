# Plan: OpenCode alongside Claude Code and Codex

No production code (`src/` untouched). Work is one example file, doc edits, a generated reference and a spec scenario. "Test first" here means: write the check, watch it fail, then edit. Checks are greps and commands, since nothing under `test/` asserts these strings (design, round 2).

Branch `feat/opencode-support`; one concern per commit, Conventional Commits, no attribution trailers beyond what the harness adds (AGENTS.md rules 1, 2, 8).

## Assumptions

- OpenCode's `opencode.json` format (`mcp.<name>`, `type: "local"`, `command` array, `environment`) is from memory and unverified; it cannot be run here. Only the example and the guide tab would change if it differs.
- Phone remote control, slash commands, `@` attachments and elicitation forms are not claimed for OpenCode.
- `openspec` is not declared in the repo's tools; if `openspec validate --all` cannot be run locally, CI's Specs job is the check and the final answer says so.
- The `mcp-server` scenario for OpenCode already exists on the branch (spec.md of the work); step 1 verifies it, it is not rewritten.
- No contradiction of any existing spec or ADR (ADR 0004, 0017 unaffected; `multi-user-server` Purpose left unchanged).

## Steps

### 1. Setup and baseline (riskiest unknown first: can the gate run at all?)
- Run `mise install` if `mise.toml`/`.tool-versions` exists, then `npm ci`.
- Test: `npm run quality` green on the untouched branch (baseline); `openspec validate --all` if available; confirm the OpenCode scenario is present in `openspec/specs/mcp-server/spec.md` under "Client portability".
- Files: none.

### 2. Config example (Req 1)
- Test first: `node -e "const j=JSON.parse(require('fs').readFileSync('opencode/opencode.example.json','utf8')); if(j.mcp.ride.type!=='local'||j.mcp.ride.environment.RIDE_SCOUTS!=='0'||!j.mcp.ride.command.some(c=>c.endsWith('src/mcp.ts')))process.exit(1)"` fails (file absent).
- Create `opencode/opencode.example.json` as in the design (`$schema`, `mcp.ride`, `command` identical to `codex/config.example.toml`: `node --env-file-if-exists=<root>/.env <root>/src/mcp.ts`, `enabled: true`, `RIDE_SCOUTS: "0"`). Compare against `codex/config.example.toml` for the exact command.
- Prettier: run `npm run format` so the format check accepts the JSON.
- Commit: `feat(docs): add an OpenCode config example`.

### 3. Connect page and its names (Req 2)
- Test first: `grep -c OpenCode docs/guide/claude-code-and-codex.md` is 0; `grep -n "Claude Code and Codex" docs/guide/.vitepress/config.mts` matches.
- `docs/guide/claude-code-and-codex.md`: keep file name; H1/title "Claude Code, Codex and OpenCode"; `[OpenCode]` code-group tab (copy example to `opencode.json` in the project or `~/.config/opencode/opencode.json`, replace `/abs/path`); hedged approval note; line that slash commands, `@` attachments and forms are Claude Code only; widen "both"/"Claude Code or Codex" in the text (lines 3, 53, 97).
- `docs/guide/.vitepress/config.mts:38`: sidebar text.
- Link texts in `several-riders.md:37`, `chat-on-your-phone.md:7`, README:111 and :139.
- Proof: guide build (`npm run docs:build` or the script in `package.json`) shows no dead link; old URL `/claude-code-and-codex` still resolves (file name kept).

### 4. Widen the remaining guide pages (Req 3, 4)
- Test first: `grep -rnE "Claude Code (or|and) Codex" docs/guide --include=*.md` lists the hits (about 15 files: self-hosting, several-riders, getting-started, plan-a-ride, library, index, limits, settings, sessions, everything, chat-on-your-phone, import-a-route; plus `docs/adr/0018` and `0019`, which are historical records: leave).
- Add OpenCode to each hit that names MCP-mode clients. Do NOT widen: the phone page's "A Claude Code or Codex session running..." row (`chat-on-your-phone.md:15`), slash-command and form mentions. Leave `reference.md` and `everything.md` to step 6 (generated).
- Proof: the grep again; every remaining hit is a phone, slash-command, form, or ADR case.

### 5. README, website, ENGINEERING, ROADMAP (Req 3, 4)
- `README.md` lines 32, 51-53, 62, 132, 158, 223 (not 73, the phone line); `site/index.html` lines 351, 365, 444, 522 (card heading and body), 592 (not 528, phone); `docs/ENGINEERING.md` and `ROADMAP.md` (163, 171) where they list clients; `docs/how-it-works.svg:148` only if the label fits, else leave and note it in the PR.
- Test first: grep as in step 4 over these files.
- Proof: open `site/index.html` structure is intact (grep the edited lines; card heading still fits its layout).
- Commit: `docs(guide): name OpenCode wherever Claude Code and Codex are named`.

### 6. Generated reference (Req 6)
- Edit wording in `scripts/reference.ts` (126, 174, 178) and `.env.example` (4, 74).
- Test: `npm run docs:reference` then `git diff --stat` shows `docs/guide/reference.md` and `everything.md` changed, and a second run yields no further diff.
- Leave `src/capabilities.ts:13`, `src/admin.ts:37` comments (no `src/` change).
- Commit: `docs(reference): regenerate the reference with OpenCode`.

### 7. Spec and final gate (Req 5, 6)
- Confirm the scenario (step 1) still parses: `openspec validate --all` if available.
- Final: `npm run quality` green; `npm run spec:review -- --base origin/main --head HEAD` has no blocking finding (`mcp-server` spec touched, no `src/` change, so no `no-spec` label needed); the final greps of steps 3-5 show only intended leftovers.
- Pull request using the template: summary, spec touched (`mcp-server`), verified (list), not verified (OpenCode never run; format from memory).

## Out of scope
`opencode:register` script, `src/` changes, other clients, HTTPS mode for OpenCode, renaming the guide file.
