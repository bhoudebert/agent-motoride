# Claude Code and Codex

In this mode the model of your Claude Code or Codex plan does the thinking,
and agentMotoride is its toolbox: roads, routing, weather, traffic, your
library and the exports. No API key is needed for that part; scouts use one if
it is set.

## Connect

::: code-group

```bash [Claude Code]
cd agent-motoride
claude              # the project ships a .mcp.json: approve the "ride" server when asked

# from anywhere, once:
claude mcp add --scope user ride -- node --env-file-if-exists=/abs/path/agent-motoride/.env /abs/path/agent-motoride/src/mcp.ts
```

```bash [Codex]
npm run codex:register    # once per machine; then start codex anywhere
```

:::

For Codex, add one line by hand under `[mcp_servers.ride]` in
`~/.codex/config.toml`, or Codex asks before every tool call (a plan makes
twenty):

```toml
default_tools_approval_mode = "approve"   # or "writes": lookups free, saving still asks
```

## Talk to it

Plain words are enough, in both:

```text
plan me a ride this Saturday, no rain, under 250 km, winding roads
show roadbook 7
make ride 7 50 km longer
briefing for ride 7
export ride 7 as GPX
```

The server tells the model that anything about rides goes to its tools, and to
fetch the full planning guidance before planning. In Codex, `ride show 7` can be
taken for a shell command: say "show roadbook 7", or add "using the ride
tools".

## Find everything it can do

Ask **"what can you do?"**, in Claude Code or Codex: the server answers with
every feature, grouped by moment (plan, ride day, on the road, after the ride,
library, settings), each with what to say. In Claude Code, `/mcp__ride__help`
shows the same list, and slash commands are shortcuts for the most frequent
ones (`/mcp__ride__plan-ride`, `/mcp__ride__plan-from`, `/mcp__ride__today`,
`/mcp__ride__rate-stretch` and others). Codex has no slash commands for MCP
servers: plain words do everything.

The same list, with the terminal command and the shortcut for each:
[Everything you can do](/everything).

## Scouts, with or without a key

A new leisure ride explores two to four areas before picking one.

| In `.env`                            | Who scouts                                                               | Paid with   |
| ------------------------------------ | ------------------------------------------------------------------------ | ----------- |
| An API key, `RIDE_SCOUTS` unset or 1 | The app's scouts, one small model session per area                       | The API key |
| `RIDE_SCOUTS=0`, or no key           | Claude Code's own subagents, one per area, in parallel, same scout brief | Your plan   |

Each subagent leaves its verdict in the road memory, like the app's scouts, so
the next plan in the region skips areas found poor. Without subagents (Codex
may not run them the same way), the model explores
the areas itself, one after the other: slower, a narrower search. Either way
the rider rules are checked in code on every route. Restart the client after
changing `.env`.

## Forms and attachments (Claude Code)

- **Your decisions in a dialog**: reviewing a ride shows one form with a rating
  per note; saving a ride that repeats one you have asks "save a copy anyway?".
  Other clients ask in the chat.
- **Attach a ride** with `@`: `@ride:ride://library`, `@ride:ride://ride/7`,
  `@ride:ride://roads/rated`. The library attachment carries the 20 newest roadbooks; ask for "more" to page through the rest.

Every tool, prompt and resource, with its inputs: see the
[reference](/reference), generated from the server itself.

## Good to know

- **The client's model plans**, so quality and cost follow that model, not
  `RIDE_MODEL`.
- **One session per server process**: routed trips and settings last until the
  client restarts the server; roadbooks, rides, the cache and traces are on disk.
- **After updating agentMotoride**, quit and relaunch Claude Code or Codex: it keeps the
  old server process otherwise.
- Every session is logged: `npm run rides -- runs` shows an `mcp-client` run,
  `npm run rides -- trace <id>` replays it.
- Files (GPX, Markdown, recorded tracks) are read and written on the machine
  that runs the server.
