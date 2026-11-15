# Design: OpenCode as a third MCP client

## Approach

OpenCode is another stdio MCP client of the same server (ADR 0004, ADR 0017): no `src/` behaviour change. Work is a connection file, words, and one spec scenario.

1. **Ship a project `opencode.json`** at the repo root, like `.mcp.json` for Claude Code (OpenCode reads a project config, so no register script like Codex's is needed):
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "ride": {
         "type": "local",
         "command": ["node", "--env-file-if-exists=.env", "src/mcp.ts"],
         "enabled": true
       }
     }
   }
   ```
   Relative paths work because OpenCode starts the server from the project directory (same as `.mcp.json`). For use from anywhere, the guide shows the same entry with absolute paths in `~/.config/opencode/opencode.json`. `.dockerignore` gets `opencode.json` only if `.mcp.json` is listed there (check at implementation).
2. **Guide.** Rename the title of `docs/guide/claude-code-and-codex.md` to "Claude Code, Codex and OpenCode" and keep the filename (links, README, `several-riders.md` stay valid). Add an `[OpenCode]` tab in the Connect code-group, a line on approval, and the differences (slash commands, subagents, approval) in the existing sections. Update the sidebar text in `docs/guide/.vitepress/config.mts`.
3. **Wording sweep.** Replace "Claude Code or Codex" with "Claude Code, Codex or OpenCode" in: `README.md` (incl. comparison table rows, MCP-mode line, the trademark note), `site/index.html` (lines ~351, 365, 444, 522, 528, 592; the card at 522 becomes a third client mention), `docs/guide/*.md` (index tagline, getting-started table and tabs, everything, others), `docs/how-it-works.svg`, `docs/ENGINEERING.md` (line 125, 794), `NOTICE.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.env.example`, `src/capabilities.ts` comment, `src/admin.ts` doc comment (comment only; the printed connection text is unchanged). Tab labels `[Claude Code / Codex]` become `[Claude Code / Codex / OpenCode]` only where the text works unchanged in OpenCode; otherwise leave them.
4. **Generated pages.** Heading strings live in `scripts/reference.ts` (`## Claude Code and Codex (MCP server)`, the `everything` intro). Change them there, then run `npm run docs:reference` so `reference.md` and `everything.md` match; never hand-edit them. Note `src/capabilities.ts` ("What to say in Claude Code or Codex") feeds the generator: wording only.
5. **Spec.** Done in this change: `openspec/specs/mcp-server/spec.md` gains the "OpenCode" scenario under "Client portability". `multi-user-server/spec.md` purpose line may take the new name (wording only).
6. **`src/check.ts`** (`npm run check`): optionally add an `opencode.json` presence line next to the `.mcp.json` one. Not required by the spec; skipped unless trivial.
7. **ROADMAP.md**: line 79 area lists clients to add; add "OpenCode supported" if the roadmap lists it as an idea, otherwise leave.

## Honesty about what is checked

OpenCode cannot be run here. The guide states only what the implementer verifies. Unverified claims go in as "not checked": slash commands for MCP prompts, subagent scouting, the tool approval setting (OpenCode has a `permission` config; the guide must not invent a key). The default text, in line with the edge-case scenario: the model explores the areas itself, as for Codex, no promise of parallel scouts. If the config format cannot be confirmed from OpenCode's own docs, ship the file but mark the guide step "format taken from the OpenCode docs, not run here".

## Errors

None new. A missing or wrong `opencode.json` shows as OpenCode not listing the server; the guide gives the check (list the MCP servers in OpenCode, `npm run mcp:smoke` to test the server itself). The "No start point yet" refusal is unchanged server behaviour.

## Testing

- No new unit test (spec: no OpenCode test in CI). `npm run mcp:smoke` stays the proof the server works over stdio.
- `npm run docs:reference` then the documentation check, `npm run docs:build` (dead links), `npm run quality`, `openspec validate --all`, `npm run spec:review -- --audit` (stale references).
- Because `src/` is touched by comments only, use the `no-spec` label with reason "comment wording only"; the spec change is also in this PR so the gate is satisfied either way.

## Alternatives rejected

- **`npm run opencode:register`** like Codex: Codex needs it because it has no project file; OpenCode does, so a script is code nobody needs.
- **Rename the guide file** to `mcp-clients.md`: breaks published links for no gain.
- **A new ADR**: shipping one more client config is not expensive to reverse and no newcomer would ask why. None written.
- **OpenCode-specific prompts or commands**: out of scope; plain words and `planningGuide` already work in any client.

## Conflicts with existing specs or ADRs

None. `mcp-server` "Client portability" says "any MCP client"; the scenario is additive. ADR 0004 and 0017 hold.

## Assumptions

- OpenCode's project config is `opencode.json` with `mcp.<name>` entries of `type: "local"` and a `command` array; the implementer re-checks against OpenCode's docs.
- OpenCode belongs to MCP mode; the CLI mode is untouched.
- The guide file name is kept.
- No ADR, no register script, no CI test for OpenCode.
- Formatting: no linter run on this file (Prettier is off for this folder; none other tried).
