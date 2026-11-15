# OpenCode as a supported MCP client

## Goal

agentMotoride works with Claude Code and Codex today. I want a rider who uses OpenCode to find it named next to them: how to connect it, what it can and cannot do, and the same on the website. Where the product needs a small addition for OpenCode to work as well, that is added too.

Finding: a search of the repository shows no mention of OpenCode anywhere. The server is a plain MCP server, so it is expected to work already; the gap is that nothing says so, nothing registers it, and nothing was checked.

## Assumptions

- "Support" means OpenCode as an MCP client of the existing server (stdio locally, HTTP on a multi-user instance), like Codex. The terminal app and its Anthropic API are untouched.
- OpenCode's config format (`opencode.json`, an `mcp` entry per server, `type: "local"` with a `command` array, or `type: "remote"` with a `url` and `headers`) is taken from memory and could not be checked here. See open questions.
- A project file `opencode.json`, shipped like `.mcp.json`, is the lightest way to connect when working inside the clone. No `npm run opencode:register` script is added: it would write the user's global config, and the request does not ask for it.
- The wording "Claude Code or Codex" becomes "Claude Code, Codex or OpenCode" where it names the MCP clients. Where it says something true only of one client (slash commands, forms, `@` attachments, subagent scouts), it stays as is.

## Requirements

1. The repository SHALL ship a project-level OpenCode config that registers the `ride` server over stdio with the same command and env-file as `.mcp.json`, so that OpenCode started in the clone lists the ride tools.
2. The guide page "Claude Code and Codex" SHALL become "Claude Code, Codex and OpenCode" (title, sidebar entry, and every link to it keeps working), with an OpenCode tab in "Connect" giving the stdio registration for a use from anywhere (absolute paths) and the approval setting that stops OpenCode asking before each tool call.
3. The guide SHALL state, for OpenCode, which Claude Code features it does not rely on, in one line each: slash commands for the server's prompts, forms, `@` attachments, and subagent scouts. It SHALL say what happens instead, as it already does for Codex, and SHALL say only what was checked.
4. `connectionText` (the text `npm run admin` prints for a new rider's connection on a multi-user instance) SHALL include an OpenCode entry with the server URL and the bearer token, next to Claude Code and Codex.
5. The README, the website (`site/index.html`), the guide's home and getting-started pages, and the `.env.example` comments SHALL name OpenCode wherever they list the MCP clients (Claude Code, Codex). The website's "Claude Code or Codex" way card SHALL read "Claude Code, Codex or OpenCode".
6. The `mcp-server` spec's "Client portability" requirement SHALL gain an OpenCode scenario, and `multi-user-server` SHALL list OpenCode among the clients that reach the instance with a rider's token.
7. The MCP server's behaviour SHALL NOT change for OpenCode: the same tools, instructions and `planningGuide`, nothing keyed to the client's name.

## Scenarios

**R1**
- WHEN OpenCode is started in the clone and the rider lists its MCP servers THEN `ride` appears connected and its tools are available.
- WHEN `.env` is absent THEN the server still starts (the env-file is optional, as in `.mcp.json`).

**R2**
- WHEN a rider opens the old guide address `/claude-code-and-codex` THEN they still reach the page (kept path or a redirect), and the sidebar shows the new title.
- WHEN the rider follows the OpenCode tab from another directory THEN the server starts with absolute paths and no per-call approval prompt appears for lookups.

**R3**
- WHEN a rider reads the guide for OpenCode THEN they are told that plain words are the way in, that slash-command shortcuts, forms and `@` attachments are Claude Code only (or not claimed for OpenCode), and that scouts run on the API key or, without subagents, by the model itself.
- Edge: a feature not verified on OpenCode is not claimed as working.

**R4**
- WHEN the administrator adds a rider THEN the printed text shows three connection entries, each with the same URL and the token shown once.
- Edge: with `RIDE_SERVER_URL` unset, the OpenCode entry shows the `https://YOUR-SERVER` placeholder like the others.

**R5**
- WHEN a rider reads the README, the website or the guide's home THEN every list of supported clients includes OpenCode, and sentences about one client's features still name only that client.

**R6**
- WHEN the specs are validated (`openspec validate --all`) THEN every added scenario parses under its requirement.

**R7**
- WHEN OpenCode connects THEN the instructions, tool list and `planningGuide` text equal those a Codex connection receives.

## Out of scope

- A registration script for OpenCode (`opencode:register`) and an `opencode/` example folder.
- OpenCode-specific slash commands, agents, plugins or skills; custom OpenCode agent definitions.
- Signing in to OpenCode with OAuth like ChatGPT and Claude chat assistants (ADR 0056): only the bearer token.
- Any change to the terminal app, the Anthropic API mode or the choice of models.
- Other clients (Cursor, Gemini CLI and so on).

## Conflicts with existing specs

- `mcp-server`, "Client portability": adds a scenario, changes none. "Work with any MCP client over stdio" already covers OpenCode; the scenario makes it explicit.
- `mcp-server`, "Client scouting when API scouts are off": unchanged. The subagent brief stays "when the client can", so a client without subagents explores itself.
- `multi-user-server`: one line adds the client name; the token and HTTPS rules are untouched.
- ADR 0004 (two modes, shared tools) and ADR 0017 (elicitation and resources): consistent; no client-specific code path is added. Documentation of the guide path rename touches no ADR.
- AGENTS.md rule 3: `connectionText` in `src/` changes a message the operator sees, so the spec of `multi-user-server` is updated in the same change. Rule 6: the guide, README and the generated reference (`npm run docs:reference`) follow.

## Open questions

- I could not run OpenCode or read its documentation here. Its config keys, whether it reads a project-level `opencode.json` by default, how it approves tool calls, and how it handles a remote server with a bearer header are unverified. If the project-file format differs, requirements 1 and 2 change. The design should check them against a real install before writing the guide, and drop any claim it cannot check.
- Whether OpenCode runs subagents in the way the scout brief assumes is unknown; R3 is worded so the guide does not depend on it.
- Renaming the guide page changes a public URL; I kept the old path working. If the maintainer prefers a new page "OpenCode" beside the existing one, requirements 2 and 5 are met with smaller edits.
- Formatting: I ran no formatter on this file; `.shelf/` is excluded from Prettier and I installed none.
