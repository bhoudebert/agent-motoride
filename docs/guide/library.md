# Your library

Rides you keep are saved in one file on your machine, `data/agentmotoride.db`.
Nothing is saved unless you ask. The library is what makes each new plan
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

## Look at it, change it

::: code-group

```bash [Terminal]
npm run rides -- list
npm run rides -- show 3
npm run ride -- --ride 3                     # open the prompt on ride 3, nothing sent yet
npm run ride -- --ride 3 "next Sunday, 50 km longer, lunch in Die"
```

```text [Claude Code / Codex]
show my rides
show ride 3
make ride 3 50 km longer, next Sunday, lunch in Die
```

:::

A change works from the saved waypoints instead of searching a new area, and
checks the weather for the new day. Save the result: it becomes a new version
and the original stays.

## Rate it

::: code-group

```bash [Terminal]
npm run rides -- rate 3 5 "superb, Col de Rousset empty"
npm run rides -- rate-leg 3 2 0 "gravel, never again"
```

```text [Claude Code / Codex]
Not a tool yet: rate from the terminal, or leave notes during
the ride and review them afterwards (Notes and review), which rates the
exact stretches of road instead of whole legs.
```

:::

Ratings run from 0 ("never again") to 5. For the details of a ride, notes
during the ride work better: see [Notes and review](/notes-and-review).

## How the library shapes later plans

- **No duplicates, enforced.** Every candidate is compared with your saved
  rides by the share of its 500 m grid cells they already cover. At 70% or more
  it is a duplicate: the planner must look elsewhere, and a save is refused
  (`/save --force`, or "save a copy anyway" in Claude Code, keeps a deliberate
  copy). From 40% it is mentioned as similar. The same roads in the opposite
  direction count as the same ride.
- **Ratings steer the choice.** Rides, legs and road stretches rated 4 or 5 are
  reused as building blocks. Those rated 0 or 1 are avoided: a loop with 10% or
  more on them is only offered when nothing else fits, and the planner must
  say so. A leg's own rating wins over the ride's.
- **Weather is never reused.** A saved ride shows the last forecast gathered,
  for reading; a plan or a change always checks the forecast afresh.

## Keep it current

::: code-group

```bash [Terminal]
npm run rides -- refresh 3            # route again: times, road mix, leg names, daylight, weather, cameras, stops
npm run rides -- refresh 3 --stops    # only the stop plan, after a bike profile change
npm run rides -- refresh all
npm run rides -- export-md 3          # the ride as a Markdown document, for your notes
npm run rides -- delete 3
```

```text [Claude Code / Codex]
refresh ride 3
export ride 3 as Markdown
```

:::

A refresh keeps the ride as it is: same waypoints, same motorway setting, with
the figures recomputed from today's map data.

::: tip Attach a ride in Claude Code
Type `@` then pick `ride:ride://ride/3` to put a saved ride into the
conversation, or `ride:ride://library` for the whole list.
:::
