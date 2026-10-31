# 0053. A sign never raises a limit, and a lower sign is used

- Status: accepted (supersedes the override in 0046)
- Date: 2026-10-31

## Context

ADR 0046 let a limit sign seen in Mapillary's street-level photos set the limit of a stretch even over a limit OpenStreetMap posts. On the first
rides it was right once (a permanent 70 on a road OpenStreetMap had at 90) and the filters caught the roadworks and side-road signs. On a
Belgian ride (roadbook 5) fourteen posted limits were overridden, many implausible: signs of 30 on a national road posted 70 or 90. A sign
cannot be told from a temporary limit, an urban stretch or a parallel road by its position and direction alone, and nothing in Mapillary's
data says a sign was removed or is permanent: only what is certainly temporary (a roadworks marker nearby) can be filtered.

The two errors do not cost the same. A limit that is too high in the roadbook file makes the app's warning late (a ticket, a licence); one that
is too low makes it early (a nuisance). Planning (slow-zone share, riding time) does not use the file, only OpenStreetMap and the country defaults.

## Decision

A sign never raises a limit. Where OpenStreetMap posts a limit and a sign (passing the filters: within 12 m, along the road, seen in the last
two years, no roadworks marker within 40 m, not on a roundabout's ring, agreeing signs) says a lower one, the lower one is used, the stretch is
marked `source: "sign"` and carries `osm`, the limit it replaced, so the app can show both. A sign that says a higher one changes nothing. Where
OpenStreetMap posts nothing (an assumed default or the built-up inference), a sign fills the stretch as before. The export lists every place where a
sign differs from a posted limit, in two lists (lower, used; higher, ignored), so the rider can check the sign or correct the map.

## Consequences

The file is never less cautious than OpenStreetMap, and the permanent 70 that OpenStreetMap had at 90 on the first ride is used. A temporary or
mistaken low sign gives an early warning until the rider says otherwise: a rider-confirmed correction (not built yet) is the way to clear one or to
confirm it. A wrong high limit with no sign beside it stays as OpenStreetMap has it.

## Alternatives considered

OpenStreetMap always wins: the permanent 70 stays at 90 and the warning is late. A sign always wins: fourteen implausible changes on one ride.
Trusting a sign photographed over more than a year as permanent, or two agreeing signs: a long roadworks zone lasts longer than a year and two
signs of the same works agree, so neither proves anything. Only asymmetry (never raise, lower when credible) is safe whatever the sign is.
