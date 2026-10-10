# How a plan is made

What happens between "a 150 km twisty loop from Thuin on Saturday at 9" and
the itinerary: who decides, who measures, who checks.

## Three roles

| Role         | Who                                     | Does                                                                            |
| ------------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| **Decides**  | the model (the planner, and its scouts) | where to look, which roads to string together, whether a loop is good enough    |
| **Measures** | local tools over open data              | road bendiness, routing, speed limits, riding time, weather, stops, cameras     |
| **Checks**   | code, after the answer                  | your limits, motorways, repeats, roads rated "never again", the stated distance |

The model never computes a distance or a time, and never states a forecast it
did not fetch. It calls tools and reads what they return.

## Step by step

1. **Your limits are read from your words** by code, before any model call:
   "150 km", "3 hours", "no rain".
2. **The planner asks what is already known**: `listSavedRides` (your
   roadbooks near the start) and `recallArea` (the road memory: areas
   already scouted and their verdict, winding roads already found, with their
   coordinates).
3. **It chooses two to four areas to scout.** No tool proposes them: the model
   picks them from what it knows of the geography ("the Fagne around Chimay",
   "the Viroinval around Couvin"), within reach of the start for your
   distance, in riding country rather than cities, and skips areas the memory
   says were found poor recently. It names a central town for each; the
   geocoder turns it into coordinates.
4. **It sends the scouts** with one call, `scoutAreas`. Code opens one small
   model session per area, in parallel, each with four tools and a brief (the
   area, the start, the date, your limits):
   - `recallArea` around its area;
   - `searchRoads` around the area's town (20 to 30 km): an OpenStreetMap query
     for the area's numbered secondary and tertiary roads, ranked by bendiness
     (degrees of turning per km), each with its two ends;
   - `calculateTrip` through a few waypoints it picks (the start, the ends of
     the best roads, the start again): Valhalla finds the path between the
     waypoints on the motorcycle profile without motorways, and the code
     measures it (distance, riding time from limits and bends, open road,
     slow zones, overlap with your roadbooks);
   - `getWeather` along the loop;
   - and it reports a candidate, or why the area cannot give one.
5. **The planner compares the reports** (sorted by code: loops found first,
   then the most open road, then the fewest slow zones) and moves on from what
   they measured: it refines the best loop (moves the waypoint that crosses a
   town centre, adds one when the loop is short) and routes it again, or, when
   nothing fits, picks other areas or searches roads itself.
6. **It finishes the chosen loop**: `getDaylight`, `getWeather` at a few points
   for the riding hours, `checkConditions` (crosswind, low sun),
   `getSpeedCameras`, `planStops` (fuel, pause and lunch from your bike
   profile, open at arrival), `getTraffic` at departure.
7. **It answers** in a fixed shape: the text, and the id of the routed trip it
   presents (`r3`). The figures saved with the ride come from that routed
   trip, never from the text.
8. **Code checks the answer** against your limits and rules. A failure goes
   back to the planner once; a slow-zone share over its target is added as a
   note.

## A real sequence

From a session planning that loop from Thuin, the planner's own calls after
its scouts reported:

```
searchRoads   {location: "Thuin, Belgium", radiusKm: 30, limit: 15}
              -> D 336 294°/km, N978a 277, D 964 263, … each with its two ends
calculateTrip {waypoints: ["Thuin, Belgium", "50.18906,4.41047", … 6 points], roundTrip: true}
              -> r1: 122.3 km, 86.5% open road            (too short)
calculateTrip {… two points added to the north …}
              -> r2: 151.4 km, 74.7% open road            (long enough, more towns)
calculateTrip {… another variant …}
              -> r3: 141.1 km, 86.8% open road            (kept)
getDaylight, getWeather ×3, checkConditions {r3}, getTraffic, getSpeedCameras {r3}, planStops {r3}
answer        routeId "r3"   ->   code check: PASS
```

The coordinates the model routes through come from `searchRoads` and
`recallArea`: the ends of the winding roads. Its work is choosing and ordering
them, then judging what the routing measured.

## Is it a search algorithm?

Not a game-tree search like minimax: there is no opponent and no tree. It is
closer to a **beam search with the model as the heuristic**: a few candidates
from what the model knows and what the memory holds, explored in parallel,
each measured exactly by the tools and refined once or twice, the best chosen
on measured criteria. The path between two waypoints is a real graph search,
done by the routing engine.

## Limits

- The choice of areas rests on the model's knowledge of the region: good where
  it knows the terrain, less so elsewhere, and not identical from one session
  to the next. The road memory makes it better each time you plan in a region.
- A plan stops after 40 rounds of tool calls; a scout after 14.
- Repeating the same lookup is caught: from the third identical call, the
  earlier result comes back with a note, and a session stuck repeating is made
  to answer.

See what your own sessions did in [What a session did](/sessions).
