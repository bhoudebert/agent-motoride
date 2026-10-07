# Your library

Rides you keep are saved in one file on your machine, `data/agentmotoride.db`.
Nothing is saved unless you ask. When an update changes how the file is
organised, the app first copies it next to itself (`agentmotoride.db.bak-v1`
and so on); once all is well, those copies can be deleted. The library is what makes each new plan
different and better: it is never repeated, and what you rated steers it.

## Save a ride

::: code-group

```text [Terminal]
refine> /save Vercors loop

(or plan and save in one go:
npm run ride -- --once --save-as "Vercors loop" "...")
```

```text [Claude Code / Codex]
save it as "Vercors loop"
```

:::

Saving again after a change creates a new version linked to the previous one;
nothing is overwritten. What is stored: the waypoints, each leg with its
distance, time and main roads, the speed-limit profile, the exact route line,
your requests and the itinerary text, and, gathered right after the save:
daylight, the forecast for the ride date, fixed cameras, stops and the stop
plan.

## Roadbooks and rides

Your library has two levels. A **roadbook** is a loop or trip as designed:
its points, legs, route line and road ratings; its number is the one you
already use ("ride 3"). A **ride** is a roadbook on one day: date, departure,
forecast, stop plan, and afterwards your notes. One roadbook can have many
rides.

::: code-group

```bash [Terminal]
npm run rides -- roadbooks           # roadbooks, newest first
npm run rides -- rides               # rides, latest date first
npm run rides -- rides --page 2      # 20 per page; the last line says how to see more

# at the refine> prompt: /roadbooks, /rides, /rides 2
```

```text [Claude Code / Codex]
list my roadbooks
what are my latest rides
more
```

:::

Each list shows 20 lines and ends with "Page 1 of 3 (45 rides)" and how to see
the next page; in Claude Code or Codex, say "more" or "page 2".

## Ride a roadbook again

Say it in a sentence. The ride is added to the roadbook, with no copy: its
forecast along the loop, daylight, wind and low sun, the stops open at your
arrival, traffic at departure, then a go or no-go and the navigation links.

::: code-group

```bash [Terminal]
npm run ride -- "plan a ride from roadbook 3 on Saturday at 9"
npm run rides -- plan 3 saturday 9:30        # the same, as a command

# with roadbook 3 open at the refine> prompt:
#   plan a ride on Sunday at 10      or      /plan sunday 10
```

```text [Claude Code / Codex]
plan a ride from roadbook 3 on Saturday at 9

show roadbook 3
plan a ride on Sunday
```

:::

Days: `2026-10-17`, `17/10`, `today`, `tomorrow`, `saturday` (or `samedi`),
`next saturday`. Times: `9`, `9:30`, `9h30`, `2pm`; without one, the
roadbook's last departure. The same day again updates that ride. In the
terminal this makes no model call. To change the route itself ("50 km
longer"), ask for the change: that goes to the planner.

## Look at it, change it

::: code-group

```bash [Terminal]
npm run rides -- show 3
npm run ride -- --roadbook 3                 # open the prompt on roadbook 3, nothing sent yet
npm run ride -- --roadbook 3 "50 km longer, lunch in Die"
```

```text [Claude Code / Codex]
show roadbook 3
make roadbook 3 50 km longer, lunch in Die
```

:::

A change works from the saved waypoints instead of searching a new area, and
checks the weather for the new day. Save the result: roadbook 3 is changed in
place, still number 3, and the design it replaced is kept as a version. Rides
still ahead follow the change: the save names them ("now following the new
route, refresh before riding") and the list marks them "route changed: refresh
it". Rides already done, or whose date has passed, keep the route they had:
showing, exporting or reviewing them uses that route, not the new one. A ride
from last Sunday you never marked shows "date passed: ridden or cancelled?" until
you rate its day, review it or cancel it. A leg you rated keeps its
rating as a rating of that road, so "never again" still counts.

::: code-group

```bash [Terminal]
npm run rides -- versions 3              # v1 90 km, replaced by "50 km longer"; v2 140 km, current
npm run rides -- restore 3 1             # back to the original; the longer one is kept too
npm run rides -- copy 3 "Drôme short"    # a separate roadbook to change on its own
npm run rides -- keep 3 saturday         # Saturday's ride stays on the route it had before the change
npm run rides -- show 3 saturday         # that ride, with the route it has
# at the refine> prompt: /save --copy "Drôme short" saves the change as a copy instead
```

```text [Claude Code / Codex]
undo that change on roadbook 3
copy roadbook 3 as Drôme short
keep Saturday's ride of roadbook 3 on the previous version
```

:::

## Rate it

::: code-group

```bash [Terminal]
npm run rides -- rate 3 5 "superb, Col de Rousset empty"     # the roads
npm run rides -- rate-leg 3 2 0 "gravel, never again"
npm run rides -- rate-day 3 saturday 2 "freezing fog"        # the day, not the roads
```

```text [Claude Code / Codex]
rate roadbook 3 five, Col de Rousset was empty
leg 2 of roadbook 3: never again, gravel
Saturday on roadbook 3 was cold and foggy, 2 out of 5
```

:::

Ratings run from 0 ("never again") to 5. A roadbook's rating, and its legs',
are about the roads and steer later plans. A day's rating is about how that
ride went (weather, traffic, company): it shows with the ride and never marks a
road, so a cold Saturday does not hurt a good loop. For the details of a ride,
notes during the ride work better: see [Notes and review](/notes-and-review).

## How the library shapes later plans

- **No duplicates, enforced.** Every candidate is compared with your saved
  rides by the share of its 500 m grid cells they already cover. At 70% or more
  it is a duplicate: the planner must look elsewhere, and a save is refused
  (`/save --force`, or saying yes when Claude Code or Codex asks, keeps a
  deliberate copy). The planner offers instead to ride that roadbook again on
  your day. From 40% it is mentioned as similar. The same roads in the opposite
  direction count as the same ride.
- **Ratings steer the choice.** Rides, legs and road stretches rated 4 or 5 are
  reused as building blocks. Those rated 0 or 1 are avoided: a loop with 10% or
  more on them is only offered when nothing else fits, and the planner must
  say so. A leg's own rating wins over the ride's.
- **Weather is never reused.** A saved ride shows the last forecast gathered,
  for reading; a plan or a change always checks the forecast afresh.

## What the app remembers

Every session leaves something behind, and the next one starts from it. Before
scouting, the planner asks the road memory what is already known around the
start: your saved rides and their ratings, the stretches you loved or never
want again, the areas scouts already visited with their verdict and how long
ago, and the winding roads earlier searches found, with their coordinates. So
an area found poor last week is not scouted again for nothing, and known
roads are routed directly instead of searched again.

::: code-group

```text [Terminal]
Automatic in every plan: the planner and its scouts consult it first.
```

```text [Claude Code / Codex]
what do you know about the Condroz?
anything about cobbles near Namur?
```

:::

The memory is built from what is already stored (the library and the traces
of past sessions), kept current by itself, and never holds weather: forecasts
are always checked fresh.

## Keep it current

::: code-group

```bash [Terminal]
npm run rides -- refresh 3            # route again: times, road mix, leg names, daylight, weather, cameras, stops
npm run rides -- refresh 3 --stops    # only the stop plan, after a bike profile change
npm run rides -- refresh all
npm run rides -- export-md 3          # the roadbook as a Markdown document with its map, for your notes
```

```text [Claude Code / Codex]
refresh roadbook 3
export roadbook 3 as Markdown
```

:::

A refresh keeps the ride as it is: same waypoints, same motorway setting, with
the figures recomputed from today's map data.

::: tip Attach a ride in Claude Code
Type `@` then pick `ride:ride://ride/3` to put a saved ride into the
conversation, or `ride:ride://library` for the whole list.
:::

## Delete, cancel, tidy

::: code-group

```bash [Terminal]
npm run rides -- cancel 3 saturday           # not riding: kept, shown as cancelled
npm run rides -- delete ride 3 2026-10-10    # a ride entered by mistake
npm run rides -- delete roadbook 3           # the loop, its rides and notes
npm run rides -- tidy                        # drop expired lookups, compact the file
```

```text [Claude Code / Codex]
I'm not riding Saturday
delete Saturday's ride of roadbook 3
delete roadbook 3
```

:::

A delete always asks first and says what goes with it: "Delete roadbook #3
"Avesnois loop", its 2 rides and 1 note? Its 1 road rating stays". Road
ratings stay because they are about the roads and keep steering your plans. In
the terminal, answer `y`, or add `--yes` in a script; in Claude Code the
question is a dialog, in other clients a question in the chat.

`tidy` keeps your traces and everything you saved. The library stays small (a
few MB, most of it a cache of map lookups that expire on their own), so tidy
is occasional housekeeping, not a need. It also lists other files next to the
library, such as the backup a migration wrote (`agentmotoride.db.bak-v1`),
and leaves them for you to delete once all is well.
