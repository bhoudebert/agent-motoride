# Spec: OpenCode as a supported MCP client

## Goal

agentMotoride works today in the terminal and in Claude Code or Codex. We want
OpenCode to be a supported client too: a rider who uses OpenCode connects the
ride tools as easily as in Claude Code or Codex, can follow a guide page that
says how, and sees OpenCode named wherever the website, the README and the guide
list the supported clients. First we check that nothing in the server stops
OpenCode (it is a plain MCP client, so the server itself should not change); we
add only what is missing.

## Requirements

1. The server SHALL need no change to work with OpenCode: over stdio it SHALL expose the same tools, prompts, resources and instructions as for any MCP client (existing "Client portability").
2. The repository SHALL ship an `opencode.json` at its root declaring a local MCP server `ride` that runs `node --env-file-if-exists=.env src/mcp.ts`, so OpenCode started in the project directory finds the tools without a registration step (as `.mcp.json` does for Claude Code).
3. `opencode.json` SHALL be valid for OpenCode's config schema (`mcp.ride` with `type: "local"`, `command` as an array, `enabled: true`) and SHALL NOT hold a secret.
4. The text printed by `npm run admin` when a rider is added (`connectionText`) SHALL include, beside Claude Code and Codex, an OpenCode `remote` entry for the server's `/mcp` address with the header `Authorization: Bearer {env:RIDE_TOKEN}`; the token SHALL still appear once.
5. The guide SHALL say how to connect OpenCode (project file, and from anywhere via the user config `~/.config/opencode/opencode.json` with absolute paths), how to talk to it, and what differs from Claude Code (no slash commands from MCP prompts unless confirmed, see open questions; plain words and `planningGuide` do everything).
6. The guide page SHALL be titled for the three clients; its address `/claude-code-and-codex` SHALL keep working (links from the README, guide and site exist).
7. Every place that names the supported clients as "Claude Code or Codex" SHALL name OpenCode too: `README.md`, `docs/guide/` pages, `site/index.html`, the generated reference heading (`scripts/reference.ts`), comments and text in `src/` that list the clients, `docs/ENGINEERING.md`, `NOTICE.md` (trademark line).
8. The README comparison table SHALL say that the model in OpenCode is the one the rider configured there (any provider), not `RIDE_MODEL`.
9. A test SHALL check that `opencode.json` parses and that its command points to a file that exists, and the existing end-to-end MCP tests SHALL stay green unchanged.
10. `npm run quality` and `openspec validate --all` SHALL pass.

## Scenarios

**R1/R2: OpenCode in the project**
- WHEN the rider starts `opencode` in the repository clone and asks "plan me a ride this Saturday, under 250 km"
- THEN the `ride` tools are available, the model calls `planningGuide` first and plans with them, as in Claude Code.
- Edge: WHEN `.env` does not exist, THEN the server still starts (`--env-file-if-exists`).

**R2: from another directory**
- WHEN the rider starts `opencode` outside the clone and has not added the user config entry
- THEN the tools are absent, and the guide says to add the entry with absolute paths (like `claude mcp add --scope user`).

**R3: schema and secrets**
- WHEN `opencode.json` is parsed
- THEN `mcp.ride.type` is `local`, `command[0]` is `node`, and no key or token string is present.

**R4: connection text**
- WHEN the administrator adds a rider
- THEN the text holds the Claude Code line, the Codex block and an OpenCode `remote` block with the `/mcp` URL and `{env:RIDE_TOKEN}`, and the token appears in the text exactly once.
- Edge: WHEN `RIDE_SERVER_URL` is unset, THEN the placeholder `https://YOUR-SERVER` is used as for the others.

**R5/R6: guide**
- WHEN a visitor opens `/claude-code-and-codex`
- THEN the page opens, titled for Claude Code, Codex and OpenCode, with a tab for OpenCode in the connect block.
- Edge: WHEN the VitePress build runs, THEN no dead link results.

**R7: no client forgotten**
- WHEN the repository is searched for "Claude Code or Codex" and "Claude Code and Codex"
- THEN each hit that lists the supported clients also names OpenCode (hits about Codex-only facts, such as `~/.codex/config.toml`, stay).

**R8: scouts without a key**
- WHEN `RIDE_SCOUTS=0` and the rider uses OpenCode
- THEN the guidance asks for parallel subagents "when the client can", otherwise the client explores the areas itself (unchanged); the guide does not promise subagents in OpenCode unless confirmed.

## Out of scope

- Any server code change for OpenCode, unless a real incompatibility is found by running it (then a separate requirement).
- A `npm run opencode:register` script (the project file and one documented command cover it; add only if asked).
- OAuth sign-in for OpenCode against the hosted server (token header only).
- Renaming the guide URL, or the `codex/` folder.
- An OpenCode plugin, agents or custom commands.

## Conflicts with existing specs

- `openspec/specs/mcp-server/spec.md`, "Client portability": extended with a scenario "OpenCode"; the "any MCP client over stdio" requirement already covers it. Consistent: no tool, hint or instruction changes.
- `openspec/specs/mcp-server/spec.md`, "Client scouting when API scouts are off": untouched; "when the client can" already covers a client without subagents.
- `openspec/specs/multi-user-server/spec.md`: purpose line names OpenCode; the admin requirement ("print its token and how to connect") gains the OpenCode entry and a scenario. The token still shows once. Consistent with "Tenants and their tokens".
- `openspec/specs/cli/spec.md` and `docs/adr/0004-two-modes-shared-tools.md`: two modes, shared tools: unchanged; OpenCode is the MCP mode. No ADR needed (no architectural choice).
- No decision record is contradicted.

This work already changed the two spec files above (spec first, per `AGENTS.md`); `src/` is not touched yet, so the spec check applies when the code lands.

## Open questions

- Does OpenCode expose MCP prompts as slash commands? Not verified (no OpenCode here). If it does not, the guide says "plain words only", as for Codex. Does not change the design.
- Can OpenCode run subagents in parallel for the scout brief? Unverified; if yes, the guide may say so, and scouts-off then costs nothing extra. Does not change the design.
- Does OpenCode's remote MCP accept a static bearer header and keep it across restarts as assumed in R4? Shape taken from its documented config; to confirm by running it. If it needs OAuth only, R4 changes.
- Rename the page and its menu entry to "Claude Code, Codex and OpenCode" while keeping the address: assumed yes.
- Tools needed to run the gate: no `mise.toml`, `.tool-versions` or Node in this sandbox, so `npm run quality` and `openspec validate --all` were NOT run; the spec edits are unvalidated.
