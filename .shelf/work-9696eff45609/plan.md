# Plan: OpenCode as a third MCP client

Docs, one config file and one spec scenario. No `src/` change, so there is no production code and no unit test to write first. "Test first" here means: write the check, watch it fail, then edit. The check for each step is named in it. Design: `design.md`. Spec: `spec.md`.

## Already done by the architect step

- `opencode.json` at the repo root (Requirement 1).
- Scenario "OpenCode" in `openspec/specs/mcp-server/spec.md` under "Client portability" (spec first, AGENTS.md rule 3).

Step 0 below only checks them.

## Steps

### 0. Riskiest first: verify the OpenCode config shape

- Files: `opencode.json` (change only if wrong).
- Check first: look for OpenCode's documented config format. Try `mise exec node@24 -- npx --yes opencode-ai --version`, or fetch https://opencode.ai/docs/mcp-servers. Confirm `$schema`, `mcp.<name>.type: "local"`, `command` as an array, `enabled`, and the user path `~/.config/opencode/opencode.json`.
- If the network or the package is unreachable, change nothing. Keep the `Assumptions` of `design.md` and say in the PR "not run against OpenCode". Do not claim a result that was not seen.
- Also run `openspec validate --all` (the scenario parses) and `npx prettier --check opencode.json`.
- Why first: every later snippet copies this shape. A wrong key would be copied six times.

### 1. Guard against broken links and format before editing

- Files: none.
- Test: run the baseline `npm run format:check` and `npm run docs:build` (`vitepress build docs/guide`). Both must pass before the change, so a later failure is ours.

### 2. The guide page: `docs/guide/claude-code-and-codex.md` and the sidebar

- Files: `docs/guide/claude-code-and-codex.md`, `docs/guide/.vitepress/config.mts` (line 38 text only).
- Edit:
  - Title "Claude Code, Codex and OpenCode". Intro sentence names the three.
  - Add an `[OpenCode]` tab in the Connect code group. Show the project file (`cd agent-motoride && opencode`, from the shipped `opencode.json`). Show a user-level snippet for `~/.config/opencode/opencode.json` with absolute paths (`/abs/path/agent-motoride/...`).
  - Say that OpenCode started in another directory needs the user-level snippet (Scenario 1 edge).
  - A short "OpenCode" note, under the Codex approval note: tool approval is OpenCode's own `permission` setting.
  - In "Talk to it": "in all three".
  - "Find everything": no slash commands, `@ride:` attachments or elicitation forms are claimed for OpenCode. Plain words do everything.
  - In "Scouts" and "Forms and attachments": OpenCode is not listed as having subagent scouts or forms (unchecked). Without subagents the model explores the areas itself. The section "Forms and attachments (Claude Code)" keeps its title.
  - "After updating": name OpenCode.
- Keep the file path `/claude-code-and-codex`. Only the title and the sidebar text change (Scenario 2).
- Test: `npm run docs:build` passes and `npm run format:check` passes. Then `grep -n "OpenCode" docs/guide/claude-code-and-codex.md` shows each item above. Then `grep -n "slash\|@ride\|subagent" ` on the file shows no sentence that gives these to OpenCode (Requirement 7).

### 3. The other guide pages

- Files: `docs/guide/index.md`, `getting-started.md`, `several-riders.md`, `self-hosting.md`, `everything.md`, `limits.md`, `settings.md`, `plan-a-ride.md`, `library.md`, `sessions.md`, `from-a-photo.md`, `import-a-route.md`, `chat-on-your-phone.md` (link text only), `from-your-phone.md` (nothing). The code-group tabs in `phone-and-gps.md`, `notes-and-review.md`, `stops-and-bike.md` change too.
- Edit:
  - "Claude Code or Codex" becomes "Claude Code, Codex or OpenCode" where it is about using the tools.
  - Tab label `[Claude Code / Codex]` becomes `[Claude Code / Codex / OpenCode]`. One mechanical `sed`, the same in every file, because VitePress syncs the tabs of one label.
  - `getting-started.md`: table header and a new `[OpenCode]` connect tab (`opencode  # in the project folder`).
  - `several-riders.md` and `self-hosting.md`: the HTTPS and token flow is not claimed for OpenCode (assumption). Leave their client text as it is, and only change the link text to the renamed page.
  - `sessions.md` line 17: `mcp-client` "for Claude Code, Codex and OpenCode".
  - `from-your-phone.md` and the phone-app text in `chat-on-your-phone.md`: untouched (Requirement 5).
  - `reference.md`: do not edit by hand. Its heading "Claude Code and Codex (MCP server)" comes from `scripts/reference.ts`, and `src/oauth.ts` points at it. Leave both.
- Test: `grep -rn "Claude Code or Codex\|Claude Code / Codex\]" docs/guide --include=*.md` lists only the lines left on purpose (`from-your-phone.md`, `reference.md`, the phone text, and the HTTPS text in `several-riders.md` and `self-hosting.md`). Then `npm run docs:build` has no dead link. Then run `npm run docs:reference` and check that `git diff docs/guide/reference.md` is empty.

### 4. README, ENGINEERING, NOTICE

- Files: `README.md`, `docs/ENGINEERING.md`, `NOTICE.md`.
- Edit:
  - README: the overview, the comparison table, the client list, the guide link text ("Claude Code, Codex and OpenCode"), the "ask what can you do" line, and the MCP-mode line (197) with "OpenCode".
  - README lines 62 and 73: the hosted-server and phone claims. Leave line 73 (phone). Line 62 (hosted, HTTPS) is left alone too.
  - README table row "Model and effort": "OpenAI models in Codex" stays. The OpenCode model is whichever one the rider configures.
  - ENGINEERING.md lines 125 and 794: name OpenCode among the MCP clients. No diagram changes, because the architecture does not change. Rule 6 applies only to a changed planner loop, MCP flow, hard rule or check.
  - NOTICE.md line 36: add OpenCode to the trademark list. README line 210 gets the same.
- Test: `grep -n OpenCode README.md docs/ENGINEERING.md NOTICE.md` shows each place. Then `npm run format:check` passes.

### 5. The website: `site/index.html`

- Files: `site/index.html`.
- Edit:
  - Lines ~365, 444, 522 (card title and its text) and 592: "Claude Code or Codex" becomes "Claude Code, Codex or OpenCode".
  - Line ~351 is checked. If it names the clients as the way to use the tools, change it. If it only names the map, leave it.
  - Line ~528 "From your phone" is NOT touched (Requirement 5).
  - Check the card layout in a browser or a screenshot if the longer title wraps badly.
- Test: `grep -n "Codex" site/index.html` shows each remaining line is the phone card or "Claude Code, Codex or OpenCode". Then `npm run format:check` passes (Prettier covers HTML here). Check `site/` is not parsed by a link test in `.github/workflows/pages.yml`, and read the workflow.

### 6. Gate and review

- Run `npm run quality`, `openspec validate --all` and `npm run docs:build`.
- Run `npm run spec:review -- --audit` (no model). It must show no stale reference and no stale code map.
- Run `npm run spec:review -- --base origin/main --head HEAD`. Our diff touches no `src/`, so the "src changed without spec" CI check does not apply. The spec scenario is already in.
- If a tool cannot run here (no network), say which and why in the PR.
- Commit in separate conventional commits, one concern each:
  - `docs(guide): add OpenCode to the MCP clients page`
  - `docs(guide): name OpenCode on the other guide pages`
  - `docs(readme): name OpenCode among the MCP clients`
  - `docs(site): name OpenCode next to Claude Code and Codex`
  - `feat(mcp): ship an OpenCode project config`, for `opencode.json` plus its spec scenario, if the architect commit is not kept as is.
- PR description: summary, spec touched (`mcp-server`), what was verified, and what was not (OpenCode itself, if it could not be run).

## Risks

- OpenCode's config format is from memory (Step 0). That is the only unchecked fact that affects what a rider types.
- The tab-label rename touches many files. It is mechanical, and the grep in Step 3 catches misses.
- A longer title on the site card may wrap (Step 5).

## Assumptions

- Those of `spec.md` and `design.md` hold: "support" means the stdio server works in OpenCode and the docs say how. OpenCode is added next to the two others. The phone and HTTPS (OAuth) text does not claim OpenCode. Features only Claude Code is known to have are not claimed for OpenCode.
- The renamed tab labels `[Claude Code / Codex / OpenCode]` are preferred over splitting each example into three tabs, because the prompts are the same plain words.
- No decision record (ADR): nothing here is costly to reverse.
- The `docs/guide/reference.md` heading and `scripts/reference.ts` keep "Claude Code and Codex": it is generated, and changing it means a change in `src/` and a spec change for no rider-visible gain. This is a choice to check.
