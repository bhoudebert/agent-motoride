# 0024. Ratings by precision: the narrowest wins, a roadbook rates the loop

- Status: accepted
- Date: 2026-10-11
- Amends: [0012](0012-rate-roads-from-notes-and-tracks.md) (how ratings steer planning)

## Context

Three kinds of rating steer planning: a roadbook's, a leg's, and a stretch's
(from a reviewed note, or rated directly). Until now a roadbook's rating spread
to all its legs as their default, and stretches were added on top. Two problems
followed:

- **Conflicts were not resolved.** A loop rated 5 with a stretch inside rated 0
  ("cobbles, never again") put the same squares in both the loved and the
  avoided set.
- **A low roadbook rating banned good roads.** Rating a loop 1 can mean the
  roads were bad, or that the loop was badly put together (too many villages
  between the good parts, a dull way back). The second is common, and it made
  every road of the loop avoided in every later plan.

## Decision

- **The narrowest rating wins, square by square:** a stretch over a leg over a
  roadbook; between two ratings of the same kind, the most recent (ratings now
  carry when they were given). A rating of 2 or 3 at a narrower level makes the
  squares neutral.
- **A roadbook rating judges the loop.** Rated 4-5, it still lifts its roads, as
  the weakest source. Rated 0-1, it does not spread to its roads; instead a new
  candidate sharing 50% or more of its squares with a loop rated 0-1 is not a
  valid proposal as new (unless the rider asks for it), and the rider's words
  are shown to the planner.
- **The rider says what was bad.** Rating a roadbook 0-1, the rider is asked:
  the roads, or the way the loop was put together? "The roads" also rates each
  of its legs, which then steer like any leg rating. In Claude Code the question
  is a dialog; elsewhere a second call with `scope`; in the terminal `--roads`
  or `--loop`.
- **Stretches keep their ends.** A stretch stores its two ends as coordinates,
  and the road memory returns them with loved and avoided stretches, so the
  planner can route through a loved stretch on purpose.
- **Existing ratings keep their meaning.** Schema step 3 copies each roadbook
  rating of 0-1 onto its legs that had none, since it was given when it meant
  the roads.

## Consequences

A loved road is never also avoided; "cobbles, never again" inside a loop you
love steers around the cobbles; a disliked loop is not proposed again while its
good roads stay usable. The cost: a low roadbook rating needs one more answer
from the rider.

## Alternatives considered

- Union of all ratings (before): contradictions, and good roads banned with a
  bad loop.
- Most recent rating wins, whatever its kind: a loop rated last would erase the
  precise stretches rated before it.
- Never let a roadbook rating touch its roads: a loved loop is good evidence
  for its roads; kept, as the weakest source.
