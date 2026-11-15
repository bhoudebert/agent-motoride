# Plan: OpenCode as a supported MCP client

Source: `spec.md`, `design.md` in this folder. No production code is written by this plan. Each step is one commit (Conventional Commits, kebab-case scope), test first where there is logic. Branch `feat/opencode-client`-style per AGENTS.md rule 1 is the implementer's call; the shelf branch already exists.

## State found in the repository

- `openspec/specs/mcp-server/spec.md` (scenario "OpenCode", line 96) and `openspec/specs/multi-user-server/spec.md` (lines 5 and 38) **already contain the OpenCode changes** (committed by the architect step). Step 1 only verifies them; do not re-edit.
- `src/admin.ts` `connectionText` has Claude Code and Codex only; `test/tenants.test.ts:221` tests it.
- `opencode.json` does not exist. `.mcp.json` is `node --env-file-if-exists=.env src/mcp.ts`.
- "Claude Code or Codex" / "Claude Code and Codex" appears in about 25 files (list in step 5).
- OpenCode is not installed here; its config format is from memory (design, "What could not be verified").

## Steps

### 1. Confirm the specs validate (riskless, gates the rest)

- Files: none edited (`openspec/specs/mcp-server/spec.md`, `openspec/specs/multi-user-server/spec.md` already changed).
- Proof: `openspec validate --all` passes (R6). If it does not, fix the scenario formatting in those two files in this step.

### 2. `connectionText` gets an OpenCode entry (R4) — the only code change

- Test first, `test/tenants.test.ts` (extend the case at line 221): output contains three entries (Claude Code, Codex, OpenCode), the token string appears with the same URL in the OpenCode entry, the token line stays once-shown; add a case with the base URL unset (`RIDE_SERVER_URL` deleted) expecting `https://YOUR-SERVER/mcp` in the OpenCode entry. Run: fails.
- Then `src/admin.ts`: add after Codex a line `OpenCode (opencode.json, "mcp"):` and the JSON entry `"ride": { "type": "remote", "url": url, "headers": { "Authorization": "Bearer <token>" }, "enabled": true }`; update the doc comment to name the three clients. Same signature.
- Proof: `npx node --test test/tenants.test.ts` (or `npm test`) green.
- Commit: `feat(admin): print an OpenCode connection for a new rider`. The spec is already touched (rule 3).

### 3. Project config `opencode.json` and its drift guard (R1, R7)

- Test first, new `test/opencode-config.test.ts` (check for an existing test reading project files first and put it there if so): `opencode.json` parses; `mcp.ride.type === "local"`; its `command` array equals `[".mcp.json".command, ...args]`; no `.env` needed (the command uses `--env-file-if-exists`). Fails (file missing).
- Then create `/opencode.json` exactly as in the design (with `$schema`, `type: "local"`, `enabled: true`).
- Proof: the test passes. Manual check of OpenCode actually listing `ride` is only possible with an install: if `which opencode` is empty, record "not run on a real install" in the PR (do not claim it).
- Commit: `feat(mcp): ship an opencode.json that registers the ride server`.

### 4. Guide page and sidebar (R2, R3) — keep the path

- Files: `docs/guide/claude-code-and-codex.md` (H1 and intro "Claude Code, Codex and OpenCode"; an OpenCode tab in "Connect" with stdio registration using absolute paths; one line each for slash commands, forms, `@` attachments and subagent scouts saying what happens instead; one "not checked on a real install" line if no install was available; approval setting only if verified, else say nothing about approval), `docs/guide/.vitepress/config.mts` (sidebar text only; link `/claude-code-and-codex` unchanged), link texts "Claude Code and Codex" in `several-riders.md:37`, `chat-on-your-phone.md:7`, `getting-started.md:87`, `sessions.md:3`, and the README link at line 111.
- Test: `npm run docs:build` (VitePress build; check `package.json` for the exact script) succeeds with no dead-link error, and `docs/guide/.vitepress/dist` (or the build output) still has `claude-code-and-codex.html`.
- Commit: `docs(guide): add OpenCode to the Claude Code and Codex page`.

### 5. Wording sweep (R5)

Change "Claude Code or Codex" to "Claude Code, Codex or OpenCode" (and "Claude Code and Codex" to "Claude Code, Codex and OpenCode") **only where the sentence names MCP clients**. Leave feature-specific sentences (slash commands, `/mcp__ride__...`, remote control "From your phone", subagent scouts, `claude mcp add`) as they are. Check each hit; do not run a blind replace.

Files: `README.md` (lines 32, 51-53, 62, 73 only if it is client-generic, 132, 158), `site/index.html` (the way card at 522 becomes `Claude Code, Codex or OpenCode`; lines 444, 592; leave the phone card at 528), `docs/guide/index.md`, `getting-started.md`, `plan-a-ride.md`, `library.md`, `limits.md`, `settings.md`, `everything.md`, `import-a-route.md`, `self-hosting.md`, `.env.example` (lines 4, 74), `src/capabilities.ts:13` and `src/oauth.ts:7` (comments only), `docs/how-it-works.svg:148` (text; keep the line width, check the picture still fits, otherwise leave it and say so). Not touched: `CHANGELOG.md` (generated), ADRs, `ROADMAP.md` history lines.

- Tests: (a) `grep -rn "Claude Code or Codex\|Claude Code and Codex"` over the listed files returns only the deliberately kept ones; list them in the PR. (b) `npm run docs:build` green. (c) `npm run format:check` (Prettier) green on the edited files, `npm run format` first.
- Commits: split by concern: `docs(readme): name OpenCode among the MCP clients`, `docs(site): name OpenCode on the website`, `docs(guide): name OpenCode wherever the clients are listed`, `chore(env): name OpenCode in the .env.example comments`.

### 6. Regenerate the reference and run the gates

- `npm run docs:reference`; the diff must be only the wording from step 5 (`docs/guide/reference.md` heading at line 185 "Claude Code and Codex (MCP server)" comes from `scripts/reference.ts`/`src/capabilities.ts`: edit the source, never the generated file).
- Run `npm run quality`, `openspec validate --all`, `npm run spec:review -- --audit` (stale references and the code map; `openspec/code-map.json` may need the new test file listed: follow the audit's message).
- Commit if the reference changed: `docs(guide): regenerate the reference`.

## Risks, in order

1. OpenCode config keys and project-file discovery are unverified (step 3, 4). Mitigation: claim only registration; the test proves the file parses and matches `.mcp.json`, not that OpenCode loads it.
2. Over-eager wording replace changing a Claude-only claim (step 5). Mitigation: reviewed per hit, kept ones listed in the PR.
3. `docs/how-it-works.svg` text may overflow its box.

## Assumptions

1. The guide page keeps its file name and path; only titles and link texts change (design assumption 1).
2. OpenCode's config is as in the design example; remote entry uses `type: "remote"`, `url`, `headers`.
3. `connectionText` gains an entry in the same plain-text style; its JSON is printed on one line.
4. The specs were already edited by the architect step; this plan verifies, not rewrites, them.
5. No ADR, no registration script, no OpenCode slash commands (spec out of scope).
6. Formatter: none run on this file (`.shelf/` is outside Prettier, none installed); the implementer runs `npm run format` on repository files.
