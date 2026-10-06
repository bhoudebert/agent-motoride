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
show ride 7
make ride 7 50 km longer
briefing for ride 7
export ride 7 as GPX
```

The server tells the model that anything about rides goes to its tools, and to
fetch the full planning guidance before planning. In Codex, `ride show 7` can be
taken for a shell command: say "show saved ride 7", or add "using the ride
tools".

## Shortcuts (Claude Code)

Slash commands are optional shortcuts; `/mcp__ride__help` lists them.

| Command                                           | Does                                                 |
| ------------------------------------------------- | ---------------------------------------------------- |
| `/mcp__ride__plan-ride <request>`                 | Plan a new leisure ride                              |
| `/mcp__ride__commute <destination> <when> [from]` | Practical trip, motorways permitted, traffic checked |
| `/mcp__ride__edit-ride <id\|name> <change>`       | Change a saved ride, or ask about it                 |
| `/mcp__ride__save-ride [name]`                    | Save the itinerary on the table                      |
| `/mcp__ride__show-ride <id\|name>`                | Everything stored about one ride                     |
| `/mcp__ride__today [id\|name]`                    | Ride-day briefing with a go or no-go                 |
| `/mcp__ride__refresh <id\|name>`                  | Recompute a ride without changing it                 |
| `/mcp__ride__export-gpx [id\|name]`               | GPX file of the current or a saved ride              |
| `/mcp__ride__export-md <id\|name> [file]`         | Markdown document of a ride                          |
| `/mcp__ride__list-roadbooks [page]`               | Saved loops and trips, 20 per page                   |
| `/mcp__ride__list-rides [page]`                   | Rides by date, latest first, 20 per page             |
| `/mcp__ride__note <text>`                         | During the ride: a note about the last 10 minutes    |
| `/mcp__ride__review [gpxPath] [ride]`             | After the ride: place the notes, confirm the ratings |

Codex has no slash commands for MCP servers; plain words do the same.

## Scouts, with or without a key

A new leisure ride explores two to four areas before picking one.

| In `.env`                            | Who scouts                                                               | Paid with   |
| ------------------------------------ | ------------------------------------------------------------------------ | ----------- |
| An API key, `RIDE_SCOUTS` unset or 1 | The app's scouts, one small model session per area                       | The API key |
| `RIDE_SCOUTS=0`, or no key           | Claude Code's own subagents, one per area, in parallel, same scout brief | Your plan   |

Without subagents (Codex may not run them the same way), the model explores
the areas itself, one after the other: slower, a narrower search. Either way
the rider rules are checked in code on every route. Restart the client after
changing `.env`.

## Forms and attachments (Claude Code)

- **Your decisions in a dialog**: reviewing a ride shows one form with a rating
  per note; saving a ride that repeats one you have asks "save a copy anyway?".
  Other clients ask in the chat.
- **Attach a ride** with `@`: `@ride:ride://library`, `@ride:ride://ride/7`,
  `@ride:ride://roads/rated`.

Every tool, prompt and resource, with its inputs: see the
[reference](/reference), generated from the server itself.

## Good to know

- **The client's model plans**, so quality and cost follow that model, not
  `RIDE_MODEL`.
- **One session per server process**: routed trips and settings last until the
  client restarts the server; saved rides, the cache and traces are on disk.
- **After updating agentMotoride**, quit and relaunch Claude Code or Codex: it keeps the
  old server process otherwise.
- Every session is logged: `npm run rides -- runs` shows an `mcp-client` run,
  `npm run rides -- trace <id>` replays it.
- Files (GPX, Markdown, recorded tracks) are read and written on the machine
  that runs the server.
