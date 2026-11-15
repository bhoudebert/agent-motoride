# Design: OpenCode alongside Claude Code and Codex

Documentation and one example config. No file in `src/`, `scripts/`, `test/` or `openspec/` changes. No new ADR and no
spec edit: the spec (requirement 8, "Conflicts with existing specs") says so; `mcp-server` "Client portability"
already covers any stdio MCP client, and ADR 0018 (clients side by side in code groups) is followed by adding a tab.

Round 1 change: the fact gate now passes. The first round used a summarising fetch tool; this one read OpenCode's own
documentation source verbatim with `curl` (see "Fact gate" and "Outside facts"). The tab, the example file and the
wording below follow from it.

## Fact gate (requirement 1)

Source: the documentation source in OpenCode's repository `anomalyco/opencode` (GitHub API: `full_name`
"anomalyco/opencode", `default_branch` "dev"), read from `raw.githubusercontent.com` on 2026-11-15. The latest release
is `v1.19.5` (published 2026-10-28; npm `opencode-ai` latest is 1.19.5, the same). That repository holds two
documentation sets: `services/site/src/docs/v1/content/` and `services/site/src/docs/content/`. The second says "V2
does not place server names directly under `mcp`" and uses `mcp.servers`; it describes the next major version, not the
release. This design follows the **v1** set, which matches the released 1.19.5. `opencode.ai` itself was refused by the
sandbox, so the rendered site was not read.

| Fact | State | What the pages say (verbatim) |
| --- | --- | --- |
| (a) file name and keys of a local stdio server | confirmed for v1 | key `mcp`, one entry per server name; `"type": "local"`; `"command"` an array (executable, then arguments); `"environment"` an object; `"enabled"` a boolean |
| (b) project and user config | confirmed for v1 | project: `opencode.json` in the project root; user: `~/.config/opencode/opencode.json` |
| (c) setting to avoid a confirmation per call | **not confirmed for MCP tools** | the permissions page says most permissions default to allow, but it has no MCP-specific sentence |

Consequence for (c) (requirement 2c): no approval advice is given, no approval key is shipped.
Consequence for the V2 risk: the example and the tab are right for 1.x. If OpenCode moves to the `mcp.servers`
layout, the file needs a new shape; the guide says "OpenCode 1.x" and links to OpenCode's MCP page so a reader can tell.
This work ships the example file and the tab for 1.x and leaves out any approval line because of (c).

## Approach

Add the name where clients are listed; add an OpenCode tab to the connect code group; ship one example config. The
claim "OpenCode can start a local stdio server from a command" is now backed by the documentation ("The command is how
the local MCP server is started."). The tab does not say more than the documentation does.

## Files touched

1. `opencode/opencode.example.json` (new; folder of its own, as `codex/`). Strict JSON, so no comment header (the
   format OpenCode documents as `opencode.jsonc` allows comments, but the spec names `.json`; the guide carries the
   instructions instead):
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "ride": {
         "type": "local",
         "command": ["node", "--env-file-if-exists=/abs/path/agent-motoride/.env", "/abs/path/agent-motoride/src/mcp.ts"],
         "enabled": true,
         "environment": { "RIDE_SCOUTS": "0" }
       }
     }
   }
   ```
   `RIDE_SCOUTS` "0" mirrors `codex/config.example.toml`: scouts that need the Anthropic key stay off. The `$schema`
   value is the one the documentation shows. Absolute paths: the command is the one the other tabs use.
2. `.dockerignore`: add `opencode` after `codex`.
3. `docs/guide/claude-code-and-codex.md` (file name and URL kept). Title "Claude Code, Codex and OpenCode"; intro names
   OpenCode. New `[OpenCode]` tab in the connect group: copy `opencode/opencode.example.json` to `opencode.json` in a
   project root, or merge its `mcp` entry into `~/.config/opencode/opencode.json`; replace `/abs/path/agent-motoride`
   with this clone's path; start `opencode` and ask in plain words; link to `https://opencode.ai/docs/mcp-servers/`.
   No approval line. Lines about `/mcp__ride__…`, `@ride:`, forms and Claude subagents stay Claude Code only; add
   "in OpenCode, plain words work" where the Codex note already says so.
4. `docs/guide/.vitepress/config.mts` (corrected path), line 38: `text` becomes "Claude Code, Codex and OpenCode"; the
   `link: "/claude-code-and-codex"` stays unchanged.
5. `docs/guide/getting-started.md`: its connect code group gets the same `[OpenCode]` tab (short form: the file to copy
   and the link to the guide page).
6. Other client mentions, from requirement 5, one by one: `README.md` (overview, comparison table where it already lists
   clients, "MCP mode" line, guide link text, trademark list), `docs/guide/*.md` (prose "Claude Code or Codex" →
   "Claude Code, Codex or OpenCode"), `site/index.html` (box, map, plan and notes captions), `docs/ENGINEERING.md`
   (the MCP-mode sentence and the `npm run mcp` row), `.github/ISSUE_TEMPLATE/bug_report.md` (Mode line),
   `NOTICE.md` (trademark list), `docs/how-it-works.svg`.
   - README comparison table: **no cell is added**. The model row ("Claude in Claude Code, OpenAI models in Codex")
     and the "pay with" row make claims that depend on the client's plan; OpenCode is not added to them, because the
     documentation read says nothing on them. OpenCode is named only in the cells that list clients ("Claude Code or
     Codex CLI (any MCP client)", "Plain words in …").

### Tab labels (point 4): decided per tab

27 code-group tabs are labelled `[Claude Code / Codex]`. A classifier over each block (markers: `/mcp__`, `@ride`,
form, dialog, attach, subagent, scout) gives:

- **Claude-only content, label unchanged (2):** `docs/guide/notes-and-review.md:79` (a form), `docs/guide/plan-a-ride.md:18`
  (the `/mcp__ride__plan-ride` shortcut).
- **Codex-specific line, label unchanged (1):** `docs/guide/from-a-photo.md:15` (`codex -i`, an image flag of Codex).
- **Plain-words prompts, label becomes `[Claude Code / Codex / OpenCode]` (24):** `getting-started.md:80`;
  `import-a-route.md:17`; `library.md:20, 51, 78, 103, 132, 153, 228, 250, 276`; `notes-and-review.md:23, 46, 106`;
  `phone-and-gps.md:43, 128, 164, 189, 219`; `plan-a-ride.md:75`; `settings.md:71, 102, 125`; `stops-and-bike.md:18`.
  The claim behind the rename is only that these blocks hold plain sentences a rider types; they hold no command
  specific to a client. It is a label for the rider's words, not a claim about OpenCode behaviour. If the implementer
  finds a block in this list with a client-specific line, the label stays.

### SVG

`docs/how-it-works.svg` line 148 (box 330 wide, text at x=18, lines at y=58 and y=78; box height 90 allows two body
lines). Replace the two body lines with "Claude Code, Codex or OpenCode" (30 characters) and "use the same tools, your plan"
(29). Method: the longest line already fitting is "same tools on your subscription" (31 characters), so every new
line is kept at 31 characters or fewer and the line count stays two.

## Left as is (requirement 6 and out of scope)

Phone and remote text (README "From your phone" and "For several riders", `chat-on-your-phone.md`, `from-your-phone.md`,
`phone-and-gps.md` prose about the phone, `several-riders.md`, `self-hosting.md`, the site's phone box),
`docs/guide/reference.md`, `scripts/reference.ts`, `.env.example`, `src/` strings, ADRs, CHANGELOG, ROADMAP,
CONTRIBUTING, `commitlint.config.js`, `AGENTS.md`, `CLAUDE.md`, `openspec/`.

## Errors and risks

- OpenCode 2.x layout (`mcp.servers`): the example is for 1.x; the guide says so.
- Claude-only claims for OpenCode: avoided (requirement 7); the tab labels are decided per tab above.
- Broken links: the page path does not change; only link text and the sidebar text do.
- The example is validated against the documentation, not by running OpenCode (not installed here).

## Testing

No code changes, so no unit tests. These are the checks; none has been run yet, since this is the design, and the
implementer reports which ran:

1. `npm run quality` (format check covers the JSON, the HTML, the markdown outside `.shelf/`).
2. `node -e 'JSON.parse(require("fs").readFileSync("opencode/opencode.example.json","utf8"))'` and a check that
   its keys are exactly `$schema`, `mcp.ride.type|command|enabled|environment`.
3. `npm run docs:build` (VitePress, `docs/guide`): resolves the links; if it cannot run offline, the PR says so.
4. Codex hits left over. Run, and review that every line printed is Codex-specific content:
   ```
   git grep -n -i codex -- . ':!codex' ':!scripts/codex-register.ts' ':!docs/guide/reference.md' \
     ':!scripts/reference.ts' ':!.env.example' ':!src' ':!docs/adr' ':!ROADMAP.md' ':!CHANGELOG.md' \
     ':!CONTRIBUTING.md' ':!commitlint.config.js' ':!AGENTS.md' ':!CLAUDE.md' ':!openspec' ':!.shelf' \
     ':!docs/guide/from-your-phone.md' ':!docs/guide/chat-on-your-phone.md' ':!docs/guide/phone-and-gps.md' \
     ':!docs/guide/several-riders.md' ':!docs/guide/self-hosting.md' \
     | grep -vi opencode | grep -v -E 'codex:register|~/.codex|codex -i|\[Codex\]|mcp_servers'
   ```
   Remaining output must be the requirement 6 phone and remote lines in README and `site/index.html` only.
5. Tab labels against Claude-only content: for each tab whose label ends in `/ OpenCode]`, the block must not match
   `/mcp__|@ride|[Ff]orm|dialog|attach|subagent|scout|codex -i`. Run:
   ```
   for f in docs/guide/*.md; do awk -v F=$f '/^```text \[Claude Code \/ Codex \/ OpenCode\]/{s=NR;b=""} \
     s&&/^```$/&&NR>s{ if (b ~ /\/mcp__|@ride|[Ff]orm|dialog|attach|subagent|scout|codex -i/) print F":"s; s=0} s{b=b" "$0}' $f; done
   ```
   It must print nothing. (This classifier was run now on the current labels: it flags exactly the 2 Claude-only tabs;
   `from-a-photo.md` is excluded by hand for `codex -i`.)
6. SVG: the line-length rule above (`awk` over the changed `<text>` lines, each ≤ 31 characters). No SVG renderer is
   installed here (`rsvg-convert`, `inkscape`, `convert` absent), so the rule is the check, not a rendering.
7. `npm run spec:review -- --audit` (stale references).

Markdown lint of this file: none run; Prettier is off for this folder and no other markdown linter is installed.

## Alternatives rejected

- The one-paragraph tab with no file (round 0): now unnecessary, the facts are confirmed.
- Following the V2 docs (`mcp.servers`): they describe the next major version, not 1.19.5.
- Approval setting for MCP tools: nothing to quote, so none is given.
- `npm run opencode:register`: out of scope, needs `scripts/`.
- Renaming every tab label: would claim parity for Claude-only and Codex-specific blocks.
- Editing `src/` client lists: changes what the app says; needs a spec change; left for a later request.

## Outside facts

All read on 2026-11-15 with `curl`, from the raw source files in OpenCode's repository (branch `dev`; latest release
`v1.19.5`, published 2026-10-28). `https://opencode.ai/docs/…` (the rendered site) was refused by the sandbox: UNVERIFIED
as rendered; the source files are what it is built from.

- MCP servers go under `mcp`, one name each (v1 docs).
  https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/v1/content/mcp-servers.mdx —
  "You can define MCP servers in your [OpenCode Config](/docs/config/) under `mcp`. Add each MCP with a unique name."
- A local server: type, command, environment, enabled. Same file —
  "Add local MCP servers using `type` to `"local"` within the MCP object." and
  "The command is how the local MCP server is started. You can also pass in a list of environment variables as well."
  and table rows "| `command`     | Array   | Y        | Command and arguments to run the MCP server." /
  "| `environment` | Object  |          | Environment variables to set when running the server." /
  "| `enabled`     | Boolean |          | Enable or disable the MCP server on startup."
- Project and user config files.
  https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/v1/content/config.mdx —
  "Add `opencode.json` in your project root." and
  "Place your global OpenCode config in `~/.config/opencode/opencode.json`."
- `$schema` value. Same config file (and the MCP file) — `"$schema": "https://opencode.ai/config.json"`.
- Default permissions (why no approval advice is given).
  https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/v1/content/permissions.mdx —
  "Most permissions default to `"allow"`." (nothing there names MCP tools).
- The next layout is different (why the example is for 1.x).
  https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/content/mcp-servers.mdx —
  "give it a unique name under `mcp.servers`. V2 does not place server names directly under `mcp`."
- Version. https://api.github.com/repos/anomalyco/opencode/releases/latest — `"tag_name": "v1.19.5"`,
  `"published_at": "2026-10-28T06:17:49Z"`; https://registry.npmjs.org/opencode-ai/latest — package `opencode-ai`,
  tarball `opencode-ai-1.19.5.tgz`.
- Rendered docs page https://opencode.ai/docs/mcp-servers/ for the link in the tab: UNVERIFIED (refused by the
  sandbox); the link is the site the source files belong to (`/docs/mcp-servers` is the path referenced inside the
  config source: "[Learn more here](/docs/mcp-servers).").

What this work ships and leaves out because of these facts: it ships the example file and the tab for OpenCode 1.x
(a, b confirmed); it leaves out any approval line (c not confirmed) and any statement about OpenCode 2.x; it leaves out
slash commands, `@ride:` attachments, forms and subagents for OpenCode (requirement 7), and any claim on OpenCode's model
or plan in the README table.
