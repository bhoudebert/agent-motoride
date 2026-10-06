# Plan a ride

Say what you want in one sentence. The planner sends scouts to two to four
riding areas at once, compares their loops, finishes the best one with
daylight, weather, cameras, stops and traffic, has code check it, and gives it
back as an itinerary you can follow.

## Ask

::: code-group

```bash [Terminal]
npm run ride -- --from "Grenoble" "this Saturday, no rain, under 250 km, winding roads"

# or the start menu: npm run ride, then 1
```

```text [Claude Code / Codex]
plan me a ride this Saturday, no rain, under 250 km, winding roads

(shortcut: /mcp__ride__plan-ride this Saturday, no rain, ...)
```

:::

Say it the way you would to a friend. What the planner understands:

- **Hard limits**: "under 250 km", "at most two hours of riding", "no rain".
  These are checked in code before you see the plan.
- **Wishes**: "winding roads", "about 150 km", "lunch around Die", "back
  before 17:00".
- **The day and time**: "this Saturday", "tomorrow, leave at 14:00".
  Relative dates work.
- **A practical trip**: "get me to Rue de la Loi, Brussels, by 9:00 Monday" is
  routed point to point, with traffic, and motorways if you allow them.

## What comes back

```text
Monts de Flandre loop, picked for the most open road of three areas scouted
Departure 09:00 | 186 km | riding 3h05 | 60 km/h | about 4h15 with breaks
Open road 79% | time at 70+: 67% | motorway: none | 30 zones 1.2% | 50 zones 14%
Daylight: sunrise 08:01, sunset 19:06, last light 19:37: fits
1. Lille -> Cassel: D 916, D 933, 52 km, 0h48 ...
...
Weather, traffic, fixed cameras, crosswind and low sun, stops with times
Map part 1/2 ... part 2/2 ... Whole ride (overview, not for navigation) ...
```

- **Open road** is the share of the ride outside towns and off motorways, the
  figure the planner maximises. **Time at 70+** is the share of riding time on
  roads limited to 70 km/h or more.
- **Riding time** comes from the speed limits and the bends of every road
  segment, without stops or traffic. The realistic total adds the breaks.
- **Stops** come from your bike's range and your rhythm: fuel before the tank
  runs low, a pause, lunch when the ride crosses midday, preferring places open
  at arrival. Set them once with `npm run rides -- bike range=250 pause=75`.
- **What to watch**: fixed speed cameras, crosswind, low sun ahead, cobbles and
  gravel, each with where and when.

## Change it

Keep talking. The planner edits the ride on the table, keeping what you did
not ask to change.

::: code-group

```text [Terminal]
refine> too long, keep it under 180 km
refine> leave at 10:00 and add a lunch stop around Die
refine> skip the D 1075, too much traffic
refine> /save Vercors loop
```

```text [Claude Code / Codex]
too long, keep it under 180 km
leave at 10:00 and add a lunch stop around Die
save it as "Vercors loop"
```

:::

Saved rides can be changed later the same way: `npm run ride -- --ride 3
"next Sunday, 50 km longer"`, or "make ride 3 50 km longer, next Sunday" in
Claude Code or Codex.

## Checked before you see it

Every itinerary is checked by code, not by the model: the distance and riding
time against your limits, no motorway when they are forbidden, no repeat of a
ride you already saved, little or nothing on roads you rated "never again",
and the distance in the text equal to the routed one. A failed check goes back
to the planner once; it fixes the ride or says plainly which limit cannot be
met.

::: info Motorways
Motorways are never used unless you allow them: `--allow-motorways`,
`/motorways on`, or "allow motorways" in Claude Code or Codex. See
[what counts as a motorway](/settings#what-counts-as-a-motorway), and how fast
expressways are kept small.
:::

## Good to know

- A plan in the terminal costs a few cents to about a dollar, depending on the
  model and how many areas are scouted. `/usage` shows it.
- Weather is always checked fresh for the day in question, also on a saved
  ride.
- Nothing is saved unless you ask. Saved rides live in one file,
  `data/agentmotoride.db`, on your machine.
