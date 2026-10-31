# Settings and rules

The goal is as much riding as possible on open road, outside towns and
villages, never on motorways. A few settings tune that; the rules behind them
are enforced in code, whatever the model is told.

## Your start point

Your start and end point is a town, a street or an address, or `"lat,lon"`. Tell
it once, "my home is Lille" (or `rideSettings` with `home`): it is saved in your
library and every later session starts from it, in Claude Code, Codex, the terminal
and on a server where each rider has their own library. `RIDE_HOME` in `.env` is only
the default for someone who has not saved one. Override it per plan with `--from` in the
terminal or "from Namur" in your request.

### What is saved, and what wins

What you set with `rideSettings` is kept in your library, not only for the session:
your start point, whether motorways are allowed, and the targets for 30 and 50
zones, long straights and fast expressways. The order, from strongest to weakest:

1. what you say for this plan (`--from`, `--max-30-pct`, "allow motorways for this ride");
2. what you saved in your library;
3. the host's environment (`RIDE_HOME`, `RIDE_ALLOW_MOTORWAYS`, `RIDE_MAX_*_PCT` in `.env`);
4. the built-in defaults.

So on a server, `.env` gives every rider a starting point and each rider's own choices
win. `rideSettings` with `reset` forgets what you saved and goes back to the host's defaults.
The bike profile (tank range, pauses) has always been kept in your library the same way.

## What counts as a motorway

**Motorway** here means the legal high-speed road category, wherever you ride:
autoroute (France, Belgium), autosnelweg (Flanders, Netherlands), Autobahn
(Germany), motorway (UK), freeway or interstate (US). Blue sign in most of
Europe, access only at junctions, no slow vehicles. It is the category that
counts, not the speed limit, which varies by country.

"Highway" is avoided on purpose: in American English it is any main road.

**Expressways** are the grey zone: dual carriageways with junctions but no
motorway status, such as the French voie express or Belgian 2x2 N-roads. Many
are now limited to 70 to 90, and those are ordinary roads here. The ones at
**100 km/h or more** are reported as **fast expressway**:

```text
motorway 0 km  |  fast expressway (100+) 12 km, 6%
```

|                              | Motorway                             | Fast expressway (100+)               | Other roads |
| ---------------------------- | ------------------------------------ | ------------------------------------ | ----------- |
| Routing, motorways forbidden | avoided wherever another road exists | discouraged                          | normal      |
| Code check, leisure ride     | forbidden                            | sent back once at 25% (your setting) | none        |

"Never motorways" is a strong penalty in the router, not an absolute ban: when
no other road exists, it takes one and the itinerary says so.

### How much fast expressway

A leisure ride is sent back once when 25% or more of it is on fast
expressways. The share is yours to set, like the slow-zone targets; it is saved
with each roadbook, and 100 turns the check off:

::: code-group

```bash [Terminal]
npm run ride -- --max-fast-pct 40 "a quick loop to the Ardennes and back"
# or RIDE_MAX_FAST_PCT=40 in .env; at the refine> prompt: /fast 40
```

```text [Claude Code / Codex]
allow up to 40% of fast expressways for this ride
```

:::

## Long straights

Open road can still be dull: a road that runs on one straight line for
kilometres, like the D 953 from Saint-Amand to Orchies. Every plan measures
them: a **long straight** is a stretch that keeps within 50 m of one straight
line for 2 km or more. The plan gives their share of the distance and the
longest ones by road:

```text
Road mix: 71% open road  |  24% on long straights (longest 6.1 km, D 916)  |  18% in 31-50 zones ...
```

They come **before the 31-50 zones** in the planner's priorities: between two
loops otherwise close, the one with fewer long straights wins, even with a
little more through villages. The target is 15% of the distance. Like the
slow-zone targets, it is not a limit: a plan over it stands, with a note
saying so. Flat country has straights everywhere, so set your own:

::: code-group

```bash [Terminal]
npm run ride -- --max-straight-pct 10 "a loop in the Avesnois, Saturday"
# or RIDE_MAX_STRAIGHT_PCT=10 in .env; at the refine> prompt: /straights 10
```

```text [Claude Code / Codex]
fewer long straight roads, at most 10% of the ride
```

:::

A stretch you rated keeps its rating: a straight road you rated 5 stays one
the plans seek out. A practical trip is not judged on straights. Roadbooks
saved before this measure get it on `refresh`.

## Allowing motorways

Motorways are forbidden by default. To allow them, for a commute for example:

::: code-group

```bash [Terminal]
npm run ride -- --allow-motorways "get me to Rue de la Loi, Brussels, by 9:00 Monday"

# RIDE_ALLOW_MOTORWAYS=1 in .env makes it the default
# at the refine> prompt: /motorways on, /motorways off
```

```text [Claude Code / Codex]
allow motorways
get me to Rue de la Loi, Brussels, by 9:00 Monday
```

:::

Allowing is not forcing. On a **practical trip** (getting somewhere on time)
the route goes point to point, the quickest sensible way, with motorways and
traffic checked for the travel hours. On a **leisure ride**, motorways only
reach the riding area and come back. A roadbook remembers its setting, so a
saved commute stays a motorway trip.

## Slow zones

| Setting          | Default     | In `.env`         | Terminal          |
| ---------------- | ----------- | ----------------- | ----------------- |
| 30 km/h zones    | at most 3%  | `RIDE_MAX_30_PCT` | `--max-30-pct 5`  |
| 31-50 km/h zones | at most 20% | `RIDE_MAX_50_PCT` | `--max-50-pct 15` |

Slow zones cannot be avoided completely: every ride leaves a town and crosses
villages. These are targets the planner works toward, moving waypoints around
the longest slow stretches, not pass or fail limits. In Claude Code or Codex: "aim for
10% in 50 zones".

Speed limits come from OpenStreetMap. A stretch with no limit tagged counts as
a 50 zone in a built-up area, and otherwise as open road at the legal default
of its country and region: 80 in France, 90 in Wallonia, 70 in Flanders, 100
in Germany.

## Repeats

New plans never repeat a roadbook you have (70% or more of the same roads). To allow
it for a session: `--allow-repeat`, or "repeats are fine" in Claude Code or Codex.

## The model and its cost (terminal)

| In `.env`     | Default           | Notes                                                                                             |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `RIDE_MODEL`  | `claude-opus-5-5` | `claude-sonnet-5-5` plans well for much less                                                      |
| `RIDE_EFFORT` | `high`            | `medium` is a good balance                                                                        |
| `RIDE_SCOUTS` | on                | `0` turns scouts off: cheaper, a narrower search; in Claude Code, its own subagents scout instead |

`/usage` at the prompt shows what the session cost so far; `npm run rides --
runs` lists every session with its model, tokens and cost.
