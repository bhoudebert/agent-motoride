# 0055. Limits learned from rides are proposals, and they only lower

- Status: accepted
- Date: 2026-10-31

## Context

A roadbook's limits come from OpenStreetMap, then road signs (ADRs 0046, 0053), then guesses (an unposted road gets the default of its
class, or 50 where it looks built up). The guesses are the weak part: on a 76 km ride, the plan had 80 and 90 on stretches where the rider
held a steady 50. The server now keeps recorded rides (ADR 0054), so it can compare what was ridden with what it planned. But speed is weak
evidence: a rider sometimes rides under the limit (traffic, a cautious day) or a little over it, and a bend or a village looks like a
limit.

## Decision

The server may propose a corrected limit from an uploaded ride that followed a roadbook of the library. Four rules keep it honest:

1. **Only guesses are questioned.** A stretch whose limit OpenStreetMap posts or a sign gives is never proposed for change. Only stretches
   whose limit was a guess or inferred.
2. **A speed never raises a limit.** As with a sign (ADR 0053), a wrong high warning is dangerous and a wrong low one is only early.
   So a proposal always lowers: it says the real limit is probably lower than the guess, never higher. A rider who rode faster than the
   plan gets nothing.
3. **Steady, long and well below.** The rider's moving points on the stretch (above 5 km/h) must cover at least 15 s, the 85th percentile
   must be at most 8 km/h above the median (a plateau, not a bend or a stop), and the 85th percentile must be at least 20 km/h below the
   guess. The proposed limit is the smallest usual value (30, 50, 60, 70, 80, 90) not below the 85th percentile minus 3 km/h, which leaves room
   for a rider who is a little under or a little over. It is never above the guess.
4. **The rider decides.** A proposal says where, the guess and the speed held, from one ride: that is weak evidence, which the list says. Nothing
   changes until the rider confirms it. A confirmed correction is kept in the library with the place (the road, either way), and applies to every
   roadbook that passes there, in place of the guess. A rejected one is not proposed again for that place. Weighing several rides that agree is
   left for later.

The first delivery is a list the rider reads (the MCP tool and the terminal), with the phone's screen decided afterwards.

## Consequences

Guesses that are too high get corrected by the rider's own riding, the safe way. Guesses that are too low stay as they are: only a sign
or OpenStreetMap can raise a limit. A rider who is always cautious on a road gets a lower limit proposed there; confirming is their
choice, and the effect is an earlier warning. One ride is weak evidence, which is why the list says so. The matching of a ride to a
roadbook uses the line and needs the ride linked to it, by origin, or by exact name when only one roadbook has it.

## Alternatives considered

Raising limits when riders keep going faster: unsafe, speeding is not a limit. Applying proposals without the rider: a cautious day would
rewrite the map. Asking the rider to tell the limit during or after the ride: nobody remembers a limit from two hours ago.
