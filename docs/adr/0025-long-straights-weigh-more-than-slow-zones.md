# 0025. Measure long straights and weigh them above the 31-50 zones

- Status: accepted
- Date: 2026-10-11

## Context

Open road is the rider's yardstick, but open road can be dull: a road such as
the D 953 from Saint-Amand to Orchies is outside towns and posted at 80, yet it
runs on one straight line for kilometres. Nothing in the route profile said so.
Curviness (degrees of heading change per km) is measured for road search, but
an average hides a long straight between two bends, and the planner had no way
to compare two loops on it.

The rider ranks it explicitly: fewer long straights matter more than fewer
31-50 zones. A few minutes through a village are fine; twenty minutes on a
ruler-straight road are not.

## Decision

- **Measure.** A long straight is a run of the route line that stays within
  ±50 m of one straight line for 2 km or more, measured as the chord between
  its ends (`straightRuns`, `src/geometry.ts`). Runs are found greedily along
  each leg; a run ends where the road leaves its corridor or turns back on
  itself. A very gentle sweeper (radius of tens of km) counts as straight,
  since it rides as one.
- **Report.** Every routed trip reports `speedLimits.longStraights`: km, share
  of the distance, and the four longest with their road (the ref first, from
  the edges they run on), leg and starting point.
- **Target.** `maxStraightPct`, 15% by default, is a target like the slow-zone
  shares, not a limit: over it, the code check adds a note for the rider and
  the itinerary stands. A practical trip (motorways permitted) is not judged on
  it. It is a setting in every mode (`--max-straight-pct`,
  `RIDE_MAX_STRAIGHT_PCT`, `/straights`, `rideSettings` `maxStraightPct`) and is
  saved with each roadbook's preferences.
- **Priority.** Between two loops otherwise close, fewer long straights win
  before fewer 31-50 zones. The planner's and the scouts' instructions say so;
  scout reports are ranked by open road, then long straights, then 50 zones,
  with the share read from the routed loop, not from the scout's text.
- **Ratings first.** A stretch the rider rated is steered by that rating
  (ADR 0024); the measure only weighs roads the rider has not judged.
- The default target lives in the system prompts; the rider's own target is
  added to the request only when it differs, so recorded evals keep replaying
  (ADR 0013).

## Consequences

- The planner can see and name the dull part of a loop ("5.7 km on the D 953")
  and replace it when a bending road runs nearby.
- Flat country is full of straights: in Flanders or the Pévèle a loop may stay
  over 15% whatever the planner does. It is a note, so the plan stands, and
  the rider can lower or raise the target.
- Roadbooks saved before this change have no measure until refreshed.
- The thresholds (50 m, 2 km, 15%) are a first calibration on a few local
  roads; they are constants, easy to tune from rides the rider reviews.

## Alternatives considered

- **Average curviness per route.** Already known per road, but an average
  hides where the straight is and cannot be named or replaced.
- **Heading change within a window.** Sensitive to the density of points in
  the route line; the corridor test is not.
- **A hard limit.** Would refuse whole regions where every road is straight;
  a target with a note matches how the slow zones already work.
