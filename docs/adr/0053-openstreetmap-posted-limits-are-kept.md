# 0053. OpenStreetMap's posted limits are kept

- Status: accepted (supersedes the override in 0046)
- Date: 2026-10-31

## Context

ADR 0046 let a limit sign seen in Mapillary's street-level photos set the limit of a stretch even over a limit OpenStreetMap posts. On the first
rides it was right once (a permanent 70 on a road OpenStreetMap had at 90) and the filters caught the roadworks and side-road signs. On a
Belgian ride (roadbook 5) fourteen posted limits were overridden, many implausible: signs of 30 on a national road posted 70 or 90. A sign
cannot be told from a temporary limit, an urban stretch or a parallel road by its position and direction alone, and nothing in Mapillary's
data says a sign was removed. A posted limit is a deliberate statement of a mapper; a guess is not.

## Decision

OpenStreetMap's posted limit is the fact and is never changed by a sign. A limit sign only fills a stretch OpenStreetMap does not post
(an assumed country default or the built-up inference), under the same filters as before (within 12 m, along the road, seen in the last two
years, no roadworks marker within 40 m, not on a roundabout's ring, agreeing signs). Where a sign says another limit than a posted one, the
posted limit stays in the file and the export lists the place with both values, so the rider can check the sign or correct OpenStreetMap.

## Consequences

A wrong posted limit stays wrong in the roadbook until someone fixes the map, as before signs existed, and the rider is told where to look.
Signs can no longer make a roadbook worse than OpenStreetMap, only better where it was guessing. The permanent 70 that beat a posted 90 on
the first ride is now only reported.

## Alternatives considered

Overriding when two signs agree: fewer wrong overrides, still some, and a rule with a number nobody can check. Overriding only signs seen
recently: the data does not say a sign was removed. Dropping signs: they still help where OpenStreetMap is silent.
