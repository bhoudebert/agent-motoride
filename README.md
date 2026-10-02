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

```bash
npm run ride -- --from "Grenoble" "Roadtrip moto this Saturday, no rain, <250km, winding roads, give me an itinerary"
```

- `--from <place>`: start and end point. A town name, a qualified name
  (`"Florac, France"`, `"Florac, Lozère"`) or `"lat,lon"`. Required unless
  `RIDE_HOME` is set.
- `--allow-motorways`: permit motorways (autoroutes). By default they are never used.
- `--max-30-pct <n>`: target ceiling for the share of the distance in zones
  limited to 30 km/h or less. Default 3.
- `--max-50-pct <n>`: target ceiling for the share in 31-50 km/h zones. Default 20.
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
affects. Press Enter on an empty line, type `exit`, or press Ctrl-D to quit.

- The conversation lives in memory only. Quitting ends it; a new run starts fresh.
- Road preferences set by flags stay fixed for the session. Motorway avoidance
  is enforced in code, so asking for motorways mid-session has no effect;
  restart with `--allow-motorways`.
- The prompt appears only in an interactive terminal. With piped input or
  output, or with `--once`, the program exits after the first answer.
- Each follow-up is billed. The conversation prefix is cached, which makes
  follow-ups much cheaper than the first run.

A run typically takes one to a few minutes and several tool rounds. Cost
depends on how many areas the model explores; the token line at the end lets
you compute it from current pricing.

## Road preferences

| Preference | Default | How it is applied |
|---|---|---|
| No motorways | on | Enforced in code: every routing call excludes motorways, whatever the model asks. The result reports `usesMotorway` and `motorwayKm` so a leak is visible |
| Few 30 km/h zones | at most 3% of distance | Measured, then steered: each routed trip reports the km and share posted at 30 or less, with the longest such stretches by road name. The model moves waypoints to bypass them and reroutes |
| Limited 50 km/h zones | at most 20% of distance | Same mechanism, for 31-50 km/h |

The two speed targets are goals, not guarantees. The router has no "avoid slow
zones" switch, so the agent gets there by rerouting around town centres, and it
reports the final shares against your targets. Speed limits come from
OpenStreetMap `maxspeed` tags. Untagged stretches are reported separately as
"unposted"; outside towns that normally means the national default applies.

## Scripts

| Command | What it does |
|---|---|
| `npm run ride -- ...` | Run the agent |
| `npm run smoke` | Call each tool once against the live APIs, without calling Claude. Use it to check connectivity and keys |
| `npm run typecheck` | Type-check with `tsc --noEmit` |

## How it works

```
CLI (src/index.ts)
  └─ planRide (src/agent.ts)
       └─ Claude API, SDK tool runner loop
            ├─ getWeather     ─> Open-Meteo
            ├─ searchRoads    ─> OpenStreetMap / Overpass
            ├─ calculateTrip  ─> Valhalla
            └─ getTraffic     ─> TomTom (optional)
```

1. `src/index.ts` parses arguments and maps API errors to readable messages.
2. `src/agent.ts` sends the system prompt, your sentence, the start point and
   today's date to Claude with the four tools attached.
3. The SDK tool runner loops: the model asks for tool calls, the runner executes
   them locally and returns the results, until the model answers without
   calling a tool. The loop is capped at 40 rounds per turn.
4. The model is instructed to treat your constraints as hard limits, to state
   only what the tools returned, and to say so when something could not be
   verified.

The agent uses adaptive thinking and enables the API's server-side refusal
fallback, which reruns the request on another model if a safety classifier
declines it. Remove the `betas` and `fallbacks` lines in `src/agent.ts` to turn
that off.

## Tools

| Tool | Input | Returns | Source | Key |
|---|---|---|---|---|
| `getWeather` | `location`, `date`, `fromHour?`, `toHour?` | Hourly temperature, rain probability and amount, wind, gusts, sky, plus a day summary with a `dry` flag | [Open-Meteo](https://open-meteo.com/), up to 16 days ahead | none |
| `searchRoads` | `location`, `radiusKm?` (5 to 40, default 25), `minLengthKm?`, `limit?` | Paved secondary and tertiary roads ranked by curviness, with end coordinates usable as waypoints, and named mountain passes | OpenStreetMap via [Overpass](https://overpass-api.de/) | none |
| `calculateTrip` | `waypoints`, `roundTrip?`, `avoidMotorways?` | Routed distance and riding time per leg and in total, motorway and toll flags, speed-limit profile (km and % at 30 or less, 31-50, above 50, unposted), Google Maps link | [Valhalla](https://valhalla1.openstreetmap.de/), motorcycle profile | none |
| `getTraffic` | `waypoints`, `departAt`, `roundTrip?` | Travel time, free-flow time and traffic delay for that departure | TomTom Routing | `TOMTOM_API_KEY` |

Notes:

- **Curviness** is cumulative heading change per km of road. Measured
  reference points: the best roads of a flat plain near Chartres score 170 to
  290, mountain roads in the Cévennes 460 to 640. It ranks roads; it is not a
  quality rating, and it says nothing about surface condition or scenery.
- **Riding time** excludes stops.
- **Locations** are geocoded with Open-Meteo, which knows towns and villages,
  not street addresses. Use `"lat,lon"` for anything else. Ambiguous names
  resolve to the match nearest your start point, so "Die" near Grenoble is the
  town in the Drôme.
- **Traffic** has only been exercised without a key. The TomTom request path is
  untested.

## Project layout

```
src/
  index.ts          CLI entry point, argument parsing, error messages
  agent.ts          System prompt, model settings, tool runner loop
  preferences.ts    Rider preferences and their defaults
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
| `Place not found` | Geocoder does not know the name. Use a nearby town or `"lat,lon"` |
| `Stopped after 40 tool rounds` | The model did not converge. Loosen the constraints or rerun |
| `.env not found. Continuing without it.` | Informational only, printed by Node when no `.env` exists |

Run `npm run smoke` to tell a data-service problem from a Claude API problem.

## Limitations

- The public Overpass and Valhalla servers are shared, rate-limited community
  services. Fine for personal use, not for heavy or commercial traffic.
- Forecasts change. A ride judged dry on Thursday should be rechecked on the day.
- Road data comes from OpenStreetMap and can be incomplete or out of date.
  Closures and roadworks are not checked.
- Sessions are not saved: a refine session cannot be resumed after quitting.
- Output is text plus a Google Maps link. There is no GPX export yet.
- Claude is the only provider. OpenAI is not implemented.
- There are no automated tests beyond the type-check and the live smoke script.
