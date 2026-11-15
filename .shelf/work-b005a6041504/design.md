# Design: OpenCode as a supported client

## Approach

No `src/` change. The server already speaks MCP over stdio to any client (`mcp-server`, "Client portability"; ADR 0004). Supporting OpenCode is one connection file plus documentation, applied by the rule in spec requirement 4. No ADR: nothing here is expensive to reverse, and ADR 0004 already decides "two modes, shared tools".

## Spec written

`openspec/specs/mcp-server/spec.md`, requirement "Client portability": scenario "OpenCode" added after "Codex CLI", requirement text unchanged (spec requirement 5). Done in this step. No other spec changes; `multi-user-server` and "Client scouting" stay as they are (the spec explains why).

## Files touched

| File | Change |
|---|---|
| `opencode.json` (new, root) | `{ "mcp": { "ride": { "type": "local", "command": ["node", "--env-file-if-exists=.env", "src/mcp.ts"], "enabled": true } } }`. Same command as `.mcp.json`. Optionally add the `$schema` key `https://opencode.ai/config.json`; skip it if unsure, since an unknown schema URL buys nothing. |
| `docs/guide/getting-started.md` | Third tab "OpenCode" in the connect code group: the project file, and a user-level `~/.config/opencode/opencode.json` snippet with absolute paths for use from another folder. Wording at the lines listed in requirement 4 (8, 10, 32, 66, 80, 87 first clause). |
| `docs/guide/claude-code-and-codex.md` | Same tab. Title and heading name OpenCode. One short "OpenCode" section with only the four facts of requirement 3 and a pointer to OpenCode's documentation for approvals, subagents, slash commands and attachments. Scouts table, `@` section and `codex:register` stay. File name and address unchanged. |
| `docs/guide/index.md`, `docs/guide/.vitepress/config.mts` | Menu text and site description (lines 9 and 38) name OpenCode. The sidebar `link` stays `/claude-code-and-codex`. |
| `README.md` | Lines per requirement 4; the comparison row "Model and effort" becomes "The MCP client's own model"; trademark line gains OpenCode. Lines 52 (scouts), 53 (slash shortcut), 62, 73, 197 (subagents), stay. |
| `site/index.html` | Lines 351, 365, 444 (first part), 522 heading, 592. Line 528 and slash-command text stay. |
| `openspec/specs/mcp-server/spec.md` | The scenario above. |

`openspec/code-map.json`, `docs/ENGINEERING.md`, `ROADMAP.md`, and the generated reference (`npm run docs:reference`) are untouched: no command, tool, setting or architecture changes. Check `ROADMAP.md` for an OpenCode idea while editing; tick it if one exists.

## Method

The text rule is mechanical and easy to get wrong either way, so the implementer:

1. greps `Claude Code`, `Codex` across the files in the table, and classifies each hit by the exceptions list of requirement 4 (phone/remote/HTTPS, Codex-only, Claude-Code-only, trademark);
2. changes only hits that list the MCP clients, in the order "Claude Code, Codex or OpenCode";
3. re-greps `OpenCode` afterwards and checks the listed exceptions are byte-identical (`git diff` shows no hunk there).

Line numbers in the spec are as of the checkout; the rule decides when they drift.

## Interfaces and data shapes

Only the OpenCode config shape: `mcp.<name>` with `type: "local"`, `command: string[]`, `enabled: boolean`. Environment variables are not set in the file; `--env-file-if-exists=.env` loads them, as in `.mcp.json`. The user-level snippet needs absolute paths for `src/mcp.ts` and, if used, the `.env` file; also a working directory is not set by OpenCode, which is why the relative form works only from the project folder.

## Errors

Nothing at runtime. The risk is a wrong config key: I could not run OpenCode. The merge reviewer starts `opencode` in the project folder and confirms the ride tools are listed (spec open question). A wrong key is a one-file fix.

## Testing

- `openspec validate --all` parses the new scenario.
- `npm run quality` (format check covers README, guide, site; `opencode.json` must pass Prettier's JSON format, so write it with 2-space indent and let `npm run format` settle it).
- `npm run spec:review -- --base origin/main --head HEAD` and `--audit` (stale references).
- VitePress build of the guide (`npm run docs:build` or the repository's equivalent) to see the tabs render and no dead link.
- Manual (reviewer): run `opencode` in the project folder.
- No unit test: no logic. The existing test that every tool is called through an MCP client already covers the server.

## Alternatives rejected

- **A `npm run opencode:register` script** like `codex:register`: Codex reads no project file, so it needs one; OpenCode reads a project `opencode.json`. Out of scope and extra code.
- **Rename the guide page** to name three clients: breaks links; only title and menu text change.
- **Document OpenCode behaviours** (approvals, subagents, slash commands) from memory: unverified claims; the guide defers to OpenCode's documentation.
- **A proposal in `openspec/changes/`**: single PR, not needed (AGENTS.md rule 3).

## Assumptions

- Spec assumptions hold (no `src/` change; guide address kept; order "Claude Code, Codex or OpenCode"; `.shelf/` line in `.prettierignore` stays out of the PR).
- The user-level config path is `~/.config/opencode/opencode.json`; this is from memory and checked by the reviewer with the rest.
- `$schema` in `opencode.json` is optional and left out by default.
- No ADR is written, since the decision is not lasting.

## Formatting check

No markdown linter available here for this file; Prettier is off for the folder.
