# Spec: OpenCode alongside Claude Code and Codex

Round 3: no change to the requirements. The review found none blocking; the red "Specs validate" job was cancelled by a newer run on the same pull request (the log ends with "The operation was canceled" after the spec checks passed), not a failure of this spec.

## Goal

A rider who uses OpenCode must find, in the guide, the README and the website, that agentMotoride works there too: same MCP server, same plain-words planning, named next to Claude Code and Codex. Today no file in the repository mentions OpenCode (checked: no match outside the request).

## Assumptions

- "Support" means the existing stdio MCP server (`src/mcp.ts`) is usable from OpenCode, as `mcp-server` "Client portability" already promises for any MCP client. No new code path, no new server behaviour.
- The extra pass is documentation, a config example and a spec scenario. A register script like `npm run codex:register` is not added: OpenCode reads a project-level `opencode.json`, so a copy-paste example is enough.
- The OpenCode setup is described from its documented `opencode.json` format (`mcp` entry of `type: "local"`, `command` array, `environment`). I could not run OpenCode here (see Open questions).
- Features that depend on Claude or ChatGPT apps (phone remote control, slash commands `/mcp__ride__*`, `@` attachments, elicitation forms) are not claimed for OpenCode.

## Requirements

1. The repository SHALL ship an OpenCode config example (`opencode/opencode.example.json`, next to `codex/config.example.toml`) that registers the `ride` server over stdio with absolute-path placeholders, `RIDE_SCOUTS` set to `0`, and the same `node --env-file-if-exists=<root>/.env <root>/src/mcp.ts` command as the Codex registration.
2. The guide page on connecting a client SHALL cover OpenCode with its own "Connect" tab, an approval note if OpenCode asks before tool calls, and the plain-words examples, and SHALL state which Claude Code-only features OpenCode lacks. The page title, its sidebar entry and its links SHALL name all three clients.
3. The README, the website (`site/index.html`) and every page under `docs/guide/` SHALL name OpenCode wherever they name "Claude Code or Codex" (or "Claude Code and Codex") as the MCP-mode clients (the "ways to use it" cards, the feature captions, the comparison table, the supported-clients line, the guide index). About fifteen guide pages say it today; none is left out. Mentions that are about Claude-only features (phone, slash commands) are not widened.
4. The "From your phone" card and text SHALL NOT claim OpenCode: it stays Claude or ChatGPT app only.
5. The `mcp-server` spec SHALL gain a scenario for OpenCode under "Client portability".
6. The generated guide reference (`npm run docs:reference`) SHALL be regenerated if its wording changes, and `npm run quality` and `openspec validate --all` SHALL pass.

## Scenarios

- **Req 1, WHEN** a rider copies the example into `opencode.json`, replaces the path placeholder and starts OpenCode, **THEN** the `ride` tools are listed and a plain-words ride request reaches `planningGuide` first. Edge: **WHEN** the path is left as the placeholder, **THEN** the doc says to replace it (no silent default).
- **Req 2, WHEN** a rider opens the connect page, **THEN** a Claude Code, a Codex and an OpenCode tab are shown. Edge: **WHEN** an old link to the page's previous address is followed, **THEN** it still resolves (keep the file name, or redirect) and no internal link breaks.
- **Req 3, WHEN** the site, README and guide pages are searched for "Claude Code or Codex", **THEN** every occurrence that describes MCP-mode clients also names OpenCode.
- **Req 4, WHEN** a rider reads the phone section, **THEN** it still lists only the Claude and ChatGPT apps.
- **Req 5, WHEN** `openspec validate --all` runs, **THEN** the new scenario parses under its requirement.

## Out of scope

- A `codex:register`-style script or any change to `src/`, tools, prompts or server instructions.
- Verifying OpenCode's model quality, subagent scouting or approval behaviour.
- Other MCP clients (Cursor, Gemini CLI, ...).
- Renaming the guide file (keeps URLs stable).

## Conflicts with existing specs

- `mcp-server` "Client portability": adds one scenario; the requirement text ("any MCP client over stdio") is unchanged, so consistent.
- `multi-user-server` Purpose line ("Claude Code or Codex"): a prose mention only; widening it to OpenCode is optional and not required, since HTTPS access for OpenCode is not claimed here.
- ADR 0004 (two modes, shared tools), ADR 0017 (elicitation, not sampling): unaffected, nothing is changed in the server. AGENTS.md rule 3: no `src/` change, so the spec-touch check is met by the spec scenario anyway.

## Open questions

- I could not run OpenCode or read its documentation here, so the config format and whether it needs an approval setting are from memory and unverified. A rider or the maintainer should try the example once before release. If the format differs, only the example file and the guide tab change.
- Does the maintainer want the HTTPS (multi-user) mode documented for OpenCode too? Not decided; left out.
