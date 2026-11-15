# Design: OpenCode as a supported MCP client

## Approach

OpenCode is an MCP client like Codex. No server code changes (R7, ADR 0004, ADR 0017): the work is a project config file, one string in `src/admin.ts`, the guide, the website, the README and two spec edits.

Nothing OpenCode-specific is added to the server: no client-name branch, no new tool, no script. Rejected: an `npm run opencode:register` (writes the user's global config, out of scope).

### What could not be verified

OpenCode is not installed here (`which opencode` is empty), and the sandbox gives no documentation. Everything below about OpenCode's config is from memory. The implementer SHALL check it against a real install if one is reachable; if not, the guide says "not checked on a real install" once, in the OpenCode tab, and claims nothing beyond the registration itself (spec R3 edge). The tests cannot prove OpenCode works; they prove the files parse and the text is present.

## Files touched

| File | Change |
| --- | --- |
| `opencode.json` (new, repo root) | Registers `ride` over stdio, same command and env-file as `.mcp.json` (R1). |
| `src/admin.ts` | `connectionText` gets an OpenCode entry; doc comment names the three clients (R4). |
| `test/tenants.test.ts` | Extend the existing `connectionText` assertion: three entries, one token, the OpenCode URL; add the placeholder case with `RIDE_SERVER_URL` unset. |
| `docs/guide/claude-code-and-codex.md` | Title "Claude Code, Codex and OpenCode"; OpenCode tab in "Connect"; per-feature lines (R2, R3). **The file keeps its name**, so `/claude-code-and-codex` still works and no redirect is needed. |
| `docs/guide/.vitepress/config.mts` | Sidebar text only; the link is unchanged. |
| `docs/guide/several-riders.md`, `chat-on-your-phone.md`, `getting-started.md`, `index.md` and the other guide pages that list the clients | Link text and "Claude Code or Codex" lists become "Claude Code, Codex or OpenCode" where they name MCP clients. Sentences about one client's feature stay. |
| `README.md` | Same wording; the comparison table row "What runs the agent" and "Model and effort" (OpenCode uses whichever model the user configured there). Link text only; URL unchanged. |
| `site/index.html` | The way card "Claude Code, Codex or OpenCode" and the other four "Claude Code or Codex" lines. The "From your phone" card (a session kept running and reached by remote control) is **not** changed: it is a Claude Code feature (`claude remote-control`). |
| `.env.example` | Comments on lines 4 and 74 name OpenCode. |
| `src/capabilities.ts` | Comment "What to say in Claude Code or Codex" only if it is user-visible in the generated reference; then run `npm run docs:reference`. |
| `openspec/specs/mcp-server/spec.md`, `openspec/specs/multi-user-server/spec.md` | See below. |

## Interfaces and data shapes

`opencode.json` (format from memory, to verify):

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

Relative paths work because OpenCode started in the clone runs the command from there (assumed, as for `.mcp.json`). The optional env-file keeps the server starting without `.env` (R1 edge).

The guide's "from anywhere" tab uses absolute paths, the same command with `/abs/path/agent-motoride/...`, put in the user's global OpenCode config. The tab names the file and the keys but leaves the location of the global config to a link to OpenCode's own docs rather than stating a path that cannot be checked here.

Approval: the guide gives one `permission` setting that lets the `ride` tools run without asking, but only after confirming it on a real install. OpenCode may allow tools by default; if so, the guide says nothing about approval for OpenCode rather than inventing a setting. This resolves the R2 scenario by dropping the claim, not by asserting it.

`connectionText` gains, after Codex:

```
OpenCode (opencode.json, "mcp"):
  "ride": { "type": "remote", "url": "<url>", "headers": { "Authorization": "Bearer <token>" }, "enabled": true }
```

Same `url` and token variables as the other two; no new parameter, same signature, so `inviteText`, `token` and the callers are untouched.

## Specs

- `mcp-server`, "Client portability": add the scenario

  > #### Scenario: OpenCode
  > - **WHEN** OpenCode is started in the project directory (the project ships `opencode.json`), or has the server in its global config, and the rider asks for a ride in plain words
  > - **THEN** it lists the ride tools, receives the same instructions and `planningGuide` as any other client, and plans with them; nothing in the server depends on the client's name

  The requirement text keeps "any MCP client over stdio"; the scenario is the only change.
- `multi-user-server`, purpose line: "from Claude Code, Codex or OpenCode", plus a scenario under the existing connection-text requirement (find it by `admin` / `connectionText` when editing): WHEN the administrator adds a rider THEN the text shows the URL and the token for Claude Code, Codex and OpenCode, with `https://YOUR-SERVER` when `RIDE_SERVER_URL` is unset. AGENTS.md rule 3 is thereby met for the `src/admin.ts` change.
- `mcp-server`, "Client scouting when API scouts are off": unchanged.

`openspec validate --all` must pass; each requirement keeps a scenario.

## Errors

Nothing new at runtime. A wrong OpenCode config key is the one risk, and it is a documentation risk: mitigated by the "checked / not checked" wording and by keeping the OpenCode claims to registration and plain-word planning.

## Tests

- `test/tenants.test.ts`: the three entries and the placeholder case.
- A small test that `opencode.json` parses and its `mcp.ride.command` equals `.mcp.json`'s command and args (guards drift between the two files). Place it beside the existing tests that read project files, if any; otherwise in `test/` as one short file.
- The MCP end-to-end tests already run the server through a client; R7 needs no test beyond them, since no client-keyed code exists.
- Gate: `npm run quality`, `openspec validate --all`, `npm run docs:reference` (no diff beyond intended), `npm run spec:review -- --audit` (stale references, code map). The guide build (`vitepress build`) confirms the unchanged link still resolves.

## Decision record

None. Adding a client to a documented list and keeping a page's path is cheap to reverse and decides nothing architectural; ADR 0004 and 0017 already cover "no client-specific paths". No supersession and no conflict with an existing spec or ADR. Without an ADR there is no decision log line to write.

## Alternatives rejected

- New guide page "OpenCode" beside the existing one: duplicates the whole page (scouts, resources, good-to-know) for one differing tab.
- Renaming the file to `claude-code-codex-and-opencode.md` with a redirect: breaks four internal links and the README URL for no gain; VitePress static hosting (GitHub Pages) has no server redirects.
- A registration script and an `opencode/` example folder: out of scope, writes user config.
- Detecting OpenCode in the server to tune instructions: violates R7.

## Assumptions

1. The old guide path is kept; only the title and sidebar text change (the spec allows "kept path or a redirect").
2. OpenCode's config format is as in the example above; if a real install shows otherwise, R1 and R2 change and the unverified parts are removed.
3. The "From your phone" card on the website and the remote-control paragraphs stay Claude Code (and Codex as written) only, since OpenCode's equivalent was not checked.
4. No ADR is written (reason above).
5. No formatter run on this file: `.shelf/` is outside Prettier and none is installed. The implementer runs `npm run format` for the repository files.
