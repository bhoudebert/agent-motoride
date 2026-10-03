# agentRide

Agentic motorcycle ride planner. You describe the ride in one sentence, for
example:

> Help me find a roadtrip moto, this Saturday, no rain, <250km, winding road and give me an itinerary

Claude decides where to look, calls tools for roads, routing, weather and
traffic, checks the result against your constraints, and prints an itinerary
with a Google Maps link.

## Requirements

- Node.js 24 or newer. The TypeScript sources run directly, there is no build step.
- A Claude API key from <https://platform.claude.com/>. A Claude Code or
  claude.ai login does not work for this; the app calls the API itself and is
  billed per token.
- Internet access to the public data services listed under [Tools](#tools).
- Optional: a TomTom API key (free tier at <https://developer.tomtom.com/>) to
  enable traffic checks.

## Setup

```bash
npm install
cp .env.example .env
```

Then edit `.env`:

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude API key |
| `RIDE_HOME` | no | Default start and end point, e.g. `Grenoble`. Overridden by `--from` |
| `TOMTOM_API_KEY` | no | Enables `getTraffic`. Without it the agent reports traffic as not checked |
| `RIDE_ALLOW_MOTORWAYS` | no | `1` to permit motorways. Default: never used |
| `RIDE_MAX_30_PCT` | no | Target max % of distance in zones of 30 km/h or less. Default `3` |
| `RIDE_MAX_50_PCT` | no | Target max % of distance in 31-50 km/h zones. Default `20` |
| `RIDE_MODEL` | no | Model ID, default `claude-opus-5-5` |
| `RIDE_EFFORT` | no | Reasoning effort: `low`, `medium`, `high`, `xhigh`, `max`. Default `high` |

`.env` is git-ignored. Never commit it.

## Usage

Two ways to start:

```bash
npm run ride                      # start menu
npm run ride -- [options] "..."   # plan directly
```

The start menu offers:

```
agentRide
  1. Plan a new ride
  2. Open a saved ride (3 saved)
  q. Quit
```

- **Plan a new ride** asks what you want and the start point, then plans.
- **Open a saved ride** lists the library, shows the ride you pick (legs, main
  roads, map link, itinerary), then offers `[e] edit`, `[g] export GPX`,
  `[r] rate`, `[b] back`.
  Edit opens the free prompt on that ride. Looking at a ride, and opening the
  prompt on it, make no API call; the first call happens when you type a
  request.

To display a saved ride without the menu: `npm run ride -- --show 3`.

Direct planning:

```bash
npm run ride -- --from "Grenoble" "Roadtrip moto this Saturday, no rain, <250km, winding roads, give me an itinerary"
```

- `--from <place>`: start and end point. A town (`"Florac, France"`), a street
  or address (`"Avenue de Bretagne, Lille"`) or `"lat,lon"`. Required unless
  `RIDE_HOME` is set.
- `--allow-motorways`: permit motorways (autoroutes), for example for a commute.
  By default they are never used.
- `--max-30-pct <n>`: target ceiling for the share of the distance in zones
  limited to 30 km/h or less. Default 3.
- `--max-50-pct <n>`: target ceiling for the share in 31-50 km/h zones. Default 20.
- `--show <id|name>`: display a saved ride and exit. No planning, no API call.
- `--ride <id|name>`: work on a saved ride. With a request, apply it; without,
  open the prompt on the ride.
- `--allow-repeat`: accept rides that repeat saved ones.
- `--save-as <name>`: save the first itinerary under this name.
- `--once`: print the itinerary and exit, without the refine prompt.
- The quoted sentence is free text. Relative dates such as "this Saturday" work
  because the app tells the model today's date.
- `npm run ride -- --help` prints usage.

The itinerary is printed on stdout. Tool calls are traced on stderr as they
happen, followed by token usage:

```
  -> searchRoads({"location":"Villard-de-Lans","radiusKm":30})
     ok, 3120 ms
  -> getWeather({"location":"Villard-de-Lans","date":"2026-10-03"})
     ok, 240 ms
  -> calculateTrip({"waypoints":["Grenoble","45.07,5.55","Die"],"roundTrip":true})
     ok, 610 ms
...
[claude-opus-5-5, 48210 tokens in, 3904 out]
```

To keep only the itinerary: `npm run ride -- ... --once 2>/dev/null`.

### Refining the itinerary

After the itinerary the program stays open on a `refine>` prompt. Type a change
in plain words and the agent edits the current ride:

```
refine> too long, keep it under 180 km
refine> leave at 10:00 instead and add a lunch stop around Die
refine> skip the D 1075, too much traffic
refine> what is the weather like if I go Sunday instead?
```

The whole conversation is kept, including every tool result, so a follow-up
reuses what was already looked up and only calls tools for what the change
affects.

Leaving is always explicit:

| Action | Effect |
|---|---|
| `/back` or Ctrl-D | Leave this ride and return to the start menu. In the menu, Ctrl-D steps back one level and quits only from the top |
| `/quit`, `exit` or Ctrl-C | Quit the program |
| Enter on an empty line | Nothing |

Leaving with an itinerary that is not saved asks once for confirmation: `/save`
it, or repeat the command to discard it.

- The conversation lives in memory only. Quitting ends it. Save the ride first
  (`/save`) to pick it up again later with `--ride`.
- The slow-zone targets set by flags stay fixed for the session. Motorways can
  be switched with `/motorways on` or `/motorways off`; asking for motorways in
  plain words while they are forbidden has no effect, by design.
- The prompt appears only in an interactive terminal. With piped input or
  output, or with `--once`, the program exits after the first answer.
- Each follow-up is billed. The conversation prefix is cached, which makes
  follow-ups much cheaper than the first run.

A run typically takes one to a few minutes and several tool rounds. Cost
depends on how many areas the model explores; the token line at the end lets
you compute it from current pricing.

## Saved rides

Rides are kept in a SQLite file, `data/agentride.db` (git-ignored; override the
path with `RIDE_DB`). Nothing is saved unless you ask.

### Saving

At the `refine>` prompt:

| Command | Effect |
|---|---|
| `/save [name]` | Save the current itinerary. Without a name, the agent's own short title is used. Saving again after a change creates a new version linked to the previous one; nothing is overwritten |
| `/list` | Saved rides |
| `/show [id\|name]` | Legs, main roads, map link and full itinerary of a saved ride. No argument: the ride loaded or saved in this session |
| `/gpx [file]` | Export the itinerary on screen, or the loaded ride, as a GPX file |
| `/rate <1-5> [note]` | Rate the ride saved or loaded in this session |
| `/motorways on\|off` | Permit or forbid motorways from now on |
| `/settings` | Show motorways state, slow-zone targets, traffic check, model and effort |
| `/usage` | Model, tokens, time and estimated cost of this session so far |
| `/trace` | Replay this session's steps so far |
| `/back` | Return to the start menu (also Ctrl-D) |
| `/quit` | Quit the program |
| `/help` | Command list |

Without the prompt: `npm run ride -- --once --save-as "Vercors loop" "..."`.

What is stored: name, start point, ride date and departure, waypoints, each leg
with its coordinates, distance, time and main roads, the speed-limit profile,
the preferences used, your requests, the itinerary text, and the route's
footprint on a 500 m grid.

Every answer carries, next to the text, the id of the routed trip it presents
(validated by the API against a schema). `/save` uses that id, so the saved
distances and geometry come from the routing result, not from the model's prose.

### Managing the library

```bash
npm run rides -- list
npm run rides -- show 3
npm run rides -- rate 3 5 "superb, Col de Rousset empty"
npm run rides -- rate-leg 3 2 2 "gravel patches"
npm run rides -- export 3         # GPX file for a GPS app
npm run rides -- runs             # every planning session: model, tokens, cost, result
npm run rides -- refresh 3        # route it again: updates distance, times, road mix
npm run rides -- refresh all
npm run rides -- delete 3
npm run rides -- clear-cache
```

### Exporting to a GPS app (GPX)

```bash
npm run rides -- export 3                  # writes exports/3-<name>.gpx
npm run rides -- export 3 ~/ride.gpx       # or a path you choose
```

Also `/gpx [file]` at the `refine>` prompt, which exports the itinerary on
screen even before it is saved, and `[g] export GPX` in the start menu after
opening a saved ride.

The file is standard GPX 1.1 and holds the ride three ways, so any app finds
what it reads:

| In the file | What it is | Used by |
|---|---|---|
| Track | The exact road line from the router, one segment per leg | Apps that follow a line. This is what keeps you on the chosen roads |
| Route | The start and each stop, in order | Apps that compute their own way between stops |
| Waypoints | The same stops as named points | Shown as markers |

Import it in a motorcycle or outdoor navigation app (Kurviger, Calimoto, OsmAnd,
Scenic) or a Garmin or TomTom unit. When the app asks, choose to follow the
**track**: an app that recalculates from the route may leave the planned roads.

Waze and Google Maps navigation cannot import GPX. For Google Maps, use the map
link in the itinerary; for speed-camera alerts next to it, run an alert app
(Waze without a destination, Radarbot) in the background.

Rides saved before this feature did not store the route line. Exporting one
routes it again from its waypoints and then keeps the line; the result can
differ slightly from the original if map data changed in between.

### How saved rides shape later planning

- **No near-duplicates.** Every routed candidate is compared with the saved
  rides by the share of its 500 m grid cells they already cover. At 70% or more
  the candidate is flagged as a duplicate and the agent must look elsewhere; from
  40% it is flagged as similar and mentioned. The same roads ridden in the
  opposite direction count as the same ride. `--allow-repeat` lifts the rule.
- **Ratings steer the choice.** The agent reads the library at the start. Legs
  and rides rated 4-5 are reused as building blocks; those rated 1-2 are avoided.
  Unrated rides only count for duplicate detection.
- **Weather is never reused.** A saved ride skips road discovery, not the
  forecast check.

### Viewing and editing a saved ride

```bash
npm run ride -- --ride 3                 # open the prompt on ride 3, nothing sent yet
npm run ride -- --ride 3 "next Sunday, 50 km longer, lunch in Die, skip Mens"
```

Without a request, the ride is loaded and the `refine>` prompt opens at once.
Type a change, a new date, or a plain question about the ride; `/show` displays
it again. Same thing from the start menu: open a saved ride, then `[e] edit`.

With a request, it is applied straight away.

Either way the session works from the saved waypoints and legs instead of
searching for an area. A change or a new date makes the agent route the ride
again and check the weather for that day. Overlap with the ride being edited is
expected and not treated as a duplicate. `/save` stores the result as a new
version; the original stays.

In a script (no terminal, or `--once`), `--ride 3` with no request replans the
ride for the coming weekend.

### Lookup cache

Tool results are cached in the same file so repeated planning does not hit the
public servers again:

| Lookup | Kept for | Why |
|---|---|---|
| Road search | 30 days | Roads rarely change, and this is the slowest call |
| Routed trip | 7 days | Stable, but closures and map edits happen |
| Weather | 1 hour | Only to avoid repeat calls within one session |
| Traffic | never | Must be live |

A cached lookup shows as `(from cache)` in the trace. `npm run rides --
clear-cache` empties it.

## Model, cost and benchmarking

Model and effort are set in `.env`:

| Setting | Values | Notes |
|---|---|---|
| `RIDE_MODEL` | `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-haiku-4-5` | Roughly $4/$20, $2/$10 and $1/$5 per million input/output tokens |
| `RIDE_EFFORT` | `low`, `medium`, `high` (default), `xhigh`, `max` | How much the model thinks and how many tool rounds it makes. Haiku ignores it and uses a fixed thinking budget |

The settings line at session start shows which model and effort are in use, and
`/usage` shows what the session has consumed so far.

Every planning session is logged to the `runs` table, whether or not the ride
was saved and whether or not it failed: model, effort, turns, model calls, tool
calls, tokens (input, cache reads, output), wall time, estimated cost, and the
resulting ride's distance, riding time, open-road share and slow-zone shares.

```bash
npm run rides -- runs          # comparison table
npm run rides -- runs --csv    # for a spreadsheet
```

A saved ride also records what its session had consumed when it was saved; it
shows as a "Planned with" line in the ride view.

To compare models fairly: use the same request and start point for each, plan
without saved rides in the way (`--allow-repeat`, or a scratch database with
`RIDE_DB`), and clear the lookup cache between runs (`npm run rides --
clear-cache`), otherwise later runs get roads and routes for free. Compare cost
against the ride you got, not cost alone.

Cost is an estimate from list prices in `src/usage.ts`, not your invoice.

## Choosing a model: benchmark results

Short version: **use `claude-sonnet-5-5`**. Effort `medium` for speed and price,
`high` for consistency. Opus and Haiku are not worth it for this app.

### What was measured

One request, planned from scratch five times on 2026-10-02 with an empty ride
library, from the same start point:

> Roadtrip moto this Saturday, no rain, <250km - less than 3h, ideally 2h30,
> winding roads, avoid motorways, avoid 30 km/h roads, limit 50 km/h towns as
> much as possible, most of the time riding over 70 km/h.

| Setup | Cost | Time | Model calls | Tool calls | Ride | Open road | 50 zones | 30 zones |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5, high | $0.40 | 272 s | 12 | 20 | 164 km, 2h44 | 77.2% | 22.1% | 0.8% |
| Sonnet 5.5, high | $0.17 | 230 s | 10 | 16 | 156 km, 2h39 | 76.3% | 21.9% | 1.8% |
| Sonnet 5.5, medium (run A) | $0.08 | 37 s | 6 | 8 | 151 km, 2h39 | 77.8% | 19.1% | 3.1% |
| Sonnet 5.5, medium (run B) | $0.11 | 58 s | 6 | 10 | 134 km, 2h24 | 66.8% | 32.0% | 1.2% |
| Haiku 4.5 | $0.12 | 342 s | 17 | 22 | 201 km, 3h24 | 72.8% | 25.5% | 1.7% |

Targets were at most 20% of the distance in 50 zones and 3% in 30 zones, with a
hard limit of 3 hours of riding.

### What it shows

- **Opus buys nothing here.** Sonnet at high effort produced a ride of the same
  quality for 41% of the price. The hard parts of this app (routing, speed
  limits, time estimate, duplicate detection) are done in code; the model
  orchestrates and judges, which does not need the top model.
- **Haiku is a false economy.** It is the cheapest per token, but it needed 17
  model calls, so it cost more than Sonnet at medium, was the slowest, and
  returned a 3h24 ride against a 3 hour limit.
- **Sonnet at medium is fast and cheap, but uneven.** One run gave the best ride
  of the whole benchmark, the other a poor one (32% in 50 zones). It explores
  less (8 to 10 tool calls against 16 to 20) and sometimes settles early.
- **The rides converge.** Three setups landed near 77% open road and 20 to 22%
  in 50 zones. That is most likely the ceiling of the terrain around the start
  point, not of the model: a bigger model does not find roads that are not there.
- **Where the money goes.** Each model call resends the whole conversation, so
  cost follows the number of calls and the size of tool results more than the
  final answer. Prompt caching already cuts that re-reading to a small fraction;
  thinking tokens, driven by effort, are the largest single line.

### Recommended settings

| Situation | `RIDE_MODEL` | `RIDE_EFFORT` | Expect |
|---|---|---|---|
| Everyday use | `claude-sonnet-5-5` | `medium` | About $0.10 and under a minute for a new ride. Check the result |
| You want it right first time | `claude-sonnet-5-5` | `high` | About $0.17 and 4 minutes |
| Editing or questioning a saved ride | `claude-sonnet-5-5` | `medium` | A few cents |

With `medium`, look at the open-road and 50 zone shares of the itinerary before
accepting it. When they are poor, ask for better at the `refine>` prompt ("too
many 50 zones, find a better loop"): a refinement costs a few cents, so Sonnet
at medium plus one retry is still far below a single Opus run.

Free in every setup: the start menu, viewing saved rides, rating, `refresh`.

### Limits of this benchmark

- **Small sample.** One run per setup, two for Sonnet at medium. Models are not
  deterministic: the same setup gives a different ride and cost each time. Treat
  the table as a strong hint, not a proof.
- **One request, one region.** A mountain area, a commute or a looser request
  may rank the setups differently.
- **The stated goal was not measured.** The request asked for most of the time
  above 70 km/h. No run reports that share, and all five rides average 56 to
  60 km/h. Open-road share is the closest figure available.
- **Timing may be skewed.** The runs were minutes apart; if the lookup cache was
  not cleared between them, later runs got road searches for free. That affects
  seconds, not cost or ride quality.
- **Costs are estimates** from list prices at the time, and prices change.

### Run it yourself

```bash
export RIDE_DB=data/bench.db              # separate database, your rides stay untouched

# for each setup: edit RIDE_MODEL / RIDE_EFFORT in .env, then
npm run rides -- clear-cache              # so no run inherits lookups from the previous one
npm run ride -- --once --from "<your start>" "<your usual request>"

npm run rides -- runs                     # compare
unset RIDE_DB
```

Do not `/save` during a benchmark: a saved ride changes what the next run sees.
Use your own start point and your own kind of request; that is the only
benchmark that tells you what to pick. Three runs per setup give a picture, one
is an anecdote.

## MCP mode: the tools in Claude Code or any MCP client

The same tools run as a Model Context Protocol server, so a client with its own
model can plan rides with them. In Claude Code that means planning on your
subscription: the client's model does the thinking, this server does roads,
routing, weather, traffic, saved rides and GPX. No API key is needed for that
part.

```bash
npm run mcp            # starts the server on stdio (a client launches this; not for typing into)
```

### Using it from Claude Code

The project ships a `.mcp.json`, so starting Claude Code in this directory
offers the server automatically (approve it when asked). To use it from
anywhere:

```bash
claude mcp add --scope user ride -- node --env-file-if-exists=/abs/path/agentRide/.env /abs/path/agentRide/src/mcp.ts
```

Then, in Claude Code:

```
/mcp__ride__plan-ride this Saturday, no rain, under 250 km, winding roads
```

That prompt carries the full planning instructions of the built-in planner, the
rider's settings and today's date. Plain requests work too ("use the ride tools
to plan…"), with less guidance.

### What the server exposes

| Tool | Purpose |
|---|---|
| `rideSettings` | Show or set the start point, motorway permission, slow-zone targets, repeat allowance. Required before anything else unless `RIDE_HOME` is set |
| `listSavedRides`, `getWeather`, `searchRoads`, `calculateTrip`, `getTraffic` | The planner's tools, unchanged |
| `scoutAreas` | Parallel scouts. They are model sessions of their own, so they need `ANTHROPIC_API_KEY` and bill it; `RIDE_SCOUTS=0` turns them off and the client's model explores by itself |
| `saveRide` | Save an itinerary to the library, from a route id of this session |
| `exportGpx` | GPX file from a route id or a saved ride |
| `listRides` | The library, one line per ride |
| prompt `plan-ride` | The planning instructions plus settings, as a slash command in Claude Code |

Every tool call is traced like a built-in session: `npm run rides -- runs` shows
an `mcp-client` run, `npm run rides -- trace <id>` replays it. Tokens and cost
are unknown to the server (the client's model is not visible to it), so those
columns stay at zero.

### Differences from the built-in planner

- **The client's model plans.** Quality and cost follow that model and its
  settings, not `RIDE_MODEL`.
- **The final answer is not schema-validated.** `saveRide` takes the route id
  explicitly instead, and refuses an id that was not routed in the session.
- **Settings live for the server's lifetime.** One server process is one
  session: routed trips, start point and preferences persist across prompts
  until the client restarts it.
- **Logging goes to stderr.** Standard output carries the protocol.

### Reloading after a change

Claude Code starts the server as a child process and keeps it for the whole
session. A change to the server code, to any module it imports, or to `.env`
needs a **full quit and relaunch of Claude Code**; the `/mcp` reconnect action
restarts remote servers only, not local ones (an open limitation in Claude
Code at the time of writing). To confirm the new code is running:

```bash
npm run rides -- runs | grep mcp-client     # a new row with a fresh time = new process
```

Each server start creates a run row before any tool is called, so no new row
means the old process is still serving. Routed trips and settings of the old
process are gone after a restart; saved rides, cache and traces are on disk and
survive.

The `plan-ride` prompt is fetched on every use, but a conversation that already
contains old answers keeps imitating them: start a fresh conversation after a
prompt change.

`npm run mcp:smoke` drives the server through a client without any model, as a
check that it starts and answers. `node scripts/mcp-prompt.ts "<request>"`
prints the `plan-ride` prompt exactly as the server serves it.

## Road preferences

The goal is as much riding as possible on open road: outside towns and
villages, never on motorways.

| Preference | Default | How it is applied |
|---|---|---|
| No motorways | on | Enforced in code: while motorways are forbidden, every routing call excludes them, whatever the model asks. The result reports `usesMotorway` and `motorwayKm` so a leak is visible |
| Open road | maximise | Every routed trip reports `openRoadPct`, the share of distance outside built-up areas and off motorways. Among loops that meet your hard constraints, the agent prefers the highest |
| 30 km/h zones | aim for at most 3% | Measured per route, with the longest such stretches by road name. The agent moves waypoints to bypass them and reroutes |
| 50 km/h zones | aim for at most 20% | Same mechanism, for 31-50 km/h |

Slow zones cannot be avoided completely: every ride leaves a town and crosses
villages. The percentages are targets to minimise toward, not pass/fail limits,
and the itinerary reports the final shares against them.

How the shares are measured: speed limits come from OpenStreetMap `maxspeed`
tags. A stretch with no tag counts as a 50 zone when it lies in a built-up area
(by the router's density data). Otherwise it is open road, assumed at the legal
default of the country and region it lies in: 80 in France, 90 in Wallonia, 70
in Flanders, 100 in Germany, and so on (table `RURAL_DEFAULT_KMH` in
`src/tools/trip.ts`). Minor lanes are capped at 60 whatever the legal default.
The saved-ride view shows how much of the open road rests on that assumption.

### Motorways and practical trips

Motorways are forbidden by default. Three ways to permit them:

| Where | How |
|---|---|
| Command line | `--allow-motorways`, or `RIDE_ALLOW_MOTORWAYS=1` in `.env` to make it the default |
| Start menu | Answer `y` to "Allow motorways?" when planning a new ride |
| During a session | `/motorways on`, and `/motorways off` to forbid them again |

```bash
npm run ride -- --allow-motorways --from "Avenue de Bretagne, Lille" \
  "go to work at Rue de la Loi, Brussels, arrive by 9:00 on Monday"
```

The current state is always visible: a settings line is printed when a session
starts, the prompt reads `refine [motorways off]>` or `refine [MOTORWAYS ON]>`,
the start menu shows the default, and `/settings` prints all settings. Each
itinerary also reports the motorway distance actually used.

Permitting is not forcing. With motorways permitted the agent decides per trip:

- **Practical trip** (commute, getting somewhere on time): point to point,
  quickest sensible route, motorways used freely, weather and traffic checked
  for the travel hours, arrival time given. No search for winding roads.
- **Leisure ride**: motorways only to reach the riding area and come back, never
  for the ride itself.

A saved ride remembers whether it was routed with motorways. `--ride` and
`rides refresh` reuse that setting, so a saved commute stays a motorway trip
without the flag.

## Riding time and traffic

Riding time is estimated per road segment: its speed limit (or the legal
default of its country and region where untagged) scaled down by how much the segment bends. A
straight road is ridden at about 95% of the limit, flowing bends at about 80%,
hairpin country at about half. Town segments are capped at 85%. Stops and
traffic are excluded.

The router's own time is kept only as an upper bound. Measured on a real loop,
it assumed about 50 km/h on roads posted at 76 on average, which made a 2h10
ride look like 2h52.

Planning relies on this road-data estimate. Traffic is the last step: once a
loop is chosen, the agent runs it through the traffic check for the planned
departure and reports the expected delay on top of the estimate. That needs
`TOMTOM_API_KEY`.

The bend factors are a heuristic, not calibrated against recorded rides. If
your real times differ consistently, adjust `bendFactor` in `src/tools/trip.ts`.

## Scripts

| Command | What it does |
|---|---|
| `npm run ride -- ...` | Run the agent |
| `npm run rides -- ...` | List, show, rate, export, replay and delete saved rides and runs |
| `npm run mcp` | MCP server on stdio, for Claude Code or another MCP client |
| `npm run mcp:smoke` | Protocol-level check of the MCP server, no model involved |
| `npm run smoke` | Call each tool once against the live APIs, without calling Claude. Use it to check connectivity and keys |
| `npm run typecheck` | Type-check with `tsc --noEmit` |

## How it works

```
CLI (src/index.ts)
  └─ planner session (src/agent.ts)
       └─ Claude API, SDK tool runner loop, schema-validated final answer
            ├─ scoutAreas     ─> 2-4 scouts in parallel (src/scouts.ts), each its own small session
            │                      ├─ searchRoads ─> OpenStreetMap / Overpass
            │                      ├─ calculateTrip ─> Valhalla
            │                      └─ getWeather ─> Open-Meteo
            ├─ listSavedRides ─> SQLite (data/agentride.db)
            ├─ getWeather     ─> Open-Meteo
            ├─ searchRoads    ─> OpenStreetMap / Overpass
            ├─ calculateTrip  ─> Valhalla
            └─ getTraffic     ─> TomTom (optional)
       every step ─> trace table (replay with `rides trace`)
```

1. `src/index.ts` parses arguments, runs the menu and the refine prompt, and
   maps API errors to readable messages.
2. `src/agent.ts` opens a session: system prompt, the rider's settings, and the
   tools. Nothing is sent until the first message.
3. The SDK tool runner loops: the model asks for tool calls, the runner executes
   them locally (several at once when the model asks for several) and returns
   the results, until the model answers without calling a tool. The loop is
   capped at 40 rounds per turn.
4. For a new leisure ride the model first calls `scoutAreas` with two to four
   candidate areas. Each scout is a separate, cheaper model session with three
   tools, running in parallel with the others; it finds roads, assembles and
   routes a loop, checks the weather, and reports a candidate with its route
   id. The planner compares the reports, confirms what matters, and presents
   the best. Scouts are not used for edits, questions or commutes.
5. The final answer is not free text: the API validates it against a schema
   (`src/schema.ts`) with two fields, the message for the rider and the routed
   trip it presents (route id, date, departure, name). That is what `/save`
   stores, so the saved figures come from the routing result, never from prose.
6. Every step, planner and scouts alike, is written to the trace table: the
   rider's messages, each model response with its tokens and tool calls, each
   tool call with input, output and duration, and the final answer.

The model is instructed to treat your constraints as hard limits, to state
only what the tools returned, and to say so when something could not be
verified.

The planner uses adaptive thinking and enables the API's server-side refusal
fallback, which reruns the request on another model if a safety classifier
declines it. Remove the `betas` and `fallbacks` lines in `src/model.ts` to turn
that off.

### Scouts

| Setting | Default | Meaning |
|---|---|---|
| `RIDE_SCOUT_MODEL` | `claude-sonnet-5-5` | Model each scout runs on |
| `RIDE_SCOUT_EFFORT` | `low` | Scouts do narrow, well-briefed work; low effort is enough |

At most four scouts per call, each capped at 14 tool rounds. Their tokens count
in the session's usage and cost. Road searches are serialised across scouts so
the public OpenStreetMap server is never hit by several at once; routing and
weather calls run in parallel. A scout that fails does not fail the plan: the
planner is told which scout failed and why.

### Replaying a session

```bash
npm run rides -- runs             # find the run id
npm run rides -- trace 7          # timeline: messages, model calls, tool calls, scouts, answer
npm run rides -- trace 7 --full   # with every payload in full
```

Also `/trace` at the `refine>` prompt for the current session. The timeline
shows, per step, the elapsed time, who acted (planner or which scout), what was
called with which input, how long it took, and a one-line reading of the result
(for a routed trip: distance, time, open road and slow-zone shares). The summary
at the end gives tokens, cost, scouts used, and time per tool. Use it to see
where a run wasted calls, why a ride came out as it did, or what a scout found
that the planner ignored.

## Tools

| Tool | Input | Returns | Source | Key |
|---|---|---|---|---|
| `getWeather` | `location`, `date`, `fromHour?`, `toHour?` | Hourly temperature, rain probability and amount, wind, gusts, sky, plus a day summary with a `dry` flag | [Open-Meteo](https://open-meteo.com/), up to 16 days ahead | none |
| `searchRoads` | `location`, `radiusKm?` (5 to 40, default 25), `minLengthKm?`, `limit?` | Paved secondary and tertiary roads ranked by curviness, with end coordinates usable as waypoints, and named mountain passes | OpenStreetMap via [Overpass](https://overpass-api.de/) | none |
| `calculateTrip` | `waypoints`, `roundTrip?`, `avoidMotorways?` | Routed distance, estimated riding time and average speed per leg and in total, motorway and toll flags, open-road share and speed-limit profile (km and % at 30 or less, 31-50, above 50, untagged open road), main roads per leg, comparison with saved rides, Google Maps link | [Valhalla](https://valhalla1.openstreetmap.de/), motorcycle profile | none |
| `listSavedRides` | `location?`, `radiusKm?` | Saved rides near a place with ratings, notes and legs | local SQLite file | none |
| `getTraffic` | `waypoints`, `departAt`, `roundTrip?` | Travel time, free-flow time and traffic delay for that departure | TomTom Routing | `TOMTOM_API_KEY` |

Notes:

- **Curviness** is cumulative heading change per km of road. Measured
  reference points: the best roads of a flat plain near Chartres score 170 to
  290, mountain roads in the Cévennes 460 to 640. It ranks roads; it is not a
  quality rating, and it says nothing about surface condition or scenery.
- **Riding time** is the app's own estimate, see
  [Riding time and traffic](#riding-time-and-traffic). It excludes stops.
- **Locations** can be towns, streets, addresses or `"lat,lon"`. Towns are
  looked up with Open-Meteo. Anything it does not know (streets, addresses,
  misspellings) goes to Photon, then Nominatim, both on OpenStreetMap data.
  Ambiguous names resolve to the match nearest your start point, so "Die" near
  Grenoble is the town in the Drôme. The trace shows what each place resolved
  to; check it when a route looks wrong.
- **Traffic** has only been exercised without a key. The TomTom request path is
  untested.

## Project layout

```
src/
  index.ts          CLI entry point, flags, refine prompt and its commands
  rides.ts          Library management command (list, show, rate, delete)
  agent.ts          System prompt, planner session, tool runner loop
  model.ts          Model and effort settings, per-model request parameters
  schema.ts         Schemas of the planner's final answer and of a scout report
  scouts.ts         Parallel scouts: one small session per candidate area
  mcp.ts            MCP server exposing the tools, saving, export and the planning prompt
  trace.ts          Replay of a session from the trace table
  session.ts        Per-session state: routed trips, duplicate comparison, usage, trace
  store.ts          SQLite storage: rides, legs, lookup cache
  library.ts        Saving the current ride, formatting saved rides
  geometry.ts       Route decoding and the grid used to compare routes
  gpx.ts            GPX export of a ride
  preferences.ts    Rider preferences and their defaults
  usage.ts          Per-session token and time accounting, cost estimate
  http.ts           fetch wrapper with timeout and error text
  tools/
    index.ts        Tool schemas and descriptions shown to the model
    geo.ts          Geocoding, distance and bearing helpers
    weather.ts      getWeather
    roads.ts        searchRoads
    trip.ts         calculateTrip
    traffic.ts      getTraffic
scripts/
  smoke.ts          Live check of every tool
  mcp-smoke.ts      Protocol-level check of the MCP server
```

The tool implementations are plain async functions with no SDK dependency.
Only `src/tools/index.ts` and `src/agent.ts` touch the Anthropic SDK, which
keeps a later port to Rust or Java, or a second provider, contained.

### Adding a tool

1. Write an async function in `src/tools/<name>.ts` that takes one input object
   and returns JSON-serialisable data. Throw an `Error` with a useful message on
   failure; the runner passes it to the model as an error result.
2. Register it in `src/tools/index.ts` with `betaZodTool`: a name, a Zod input
   schema, and a description that says when to use it.
3. Add a line to `scripts/smoke.ts`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `No Claude credentials...` | `.env` missing or `ANTHROPIC_API_KEY` empty |
| `Claude API rejected the credentials` | Key invalid or revoked |
| `Claude API rate limit hit` | Wait a minute, or lower `RIDE_EFFORT` |
| `No start point...` | Pass `--from` or set `RIDE_HOME` |
| Agent says "traffic not checked" | Expected without `TOMTOM_API_KEY`. Add the key to `.env` to enable traffic |
| Agent says the road search failed on a first try | Public Overpass servers are shared and sometimes overloaded. The tool retries five times across three servers, which can take up to a minute, and the model retries too. Usually harmless |
| `searchRoads` fails with "unavailable right now" | All Overpass attempts failed. Retry later |
| Speed-limit share reported as unverified | The Valhalla speed lookup failed for that route. Distance and time are still valid |
| `Place not found` | None of the three geocoders knows the text. Check spelling, write it as `"street, town"`, or use `"lat,lon"` |
| `Stopped after 40 tool rounds` | The model did not converge. Loosen the constraints or rerun |
| `.env not found. Continuing without it.` | Informational only, printed by Node when no `.env` exists |

Run `npm run smoke` to tell a data-service problem from a Claude API problem.

## Limitations

- The public Overpass and Valhalla servers are shared, rate-limited community
  services. Fine for personal use, not for heavy or commercial traffic.
- Forecasts change. A ride judged dry on Thursday should be rechecked on the day.
- Road data comes from OpenStreetMap and can be incomplete or out of date.
  Closures and roadworks are not checked.
- A saved ride keeps the result, not the conversation: `--ride` starts a new
  conversation from the stored ride.
- Duplicate detection compares road footprints. The way out of and back into
  your home town is shared by most rides and counts toward the overlap.
- The built-in SQLite module of Node is recent; the file format is standard
  SQLite and readable by any SQLite tool.
- Output is text, a Google Maps link and a GPX file on request. Nothing can be
  sent to Waze.
- Claude is the only provider. OpenAI is not implemented.
- There are no automated tests beyond the type-check and the live smoke script.
