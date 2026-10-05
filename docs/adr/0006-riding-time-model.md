# 0006. Riding time from speed limits and curvature, not from the router

- Status: accepted
- Date: 2026-10-05

## Context

The public router's times assumed about 50 km/h on roads posted at 76 on
average, making a 2h10 loop look like 2h52 and pushing the planner to reject
good areas. Many roads carry no speed-limit tag.

## Decision

Riding time is estimated per road segment: the posted limit, or the legal
default of the segment's country and region when untagged (built-up areas count
as 50), multiplied by a bend factor from the segment's curvature (about 95% on
straight roads, 80% on flowing bends, 50% in hairpins), capped at 85% in towns.
The router's time is kept as an upper bound. The same segment walk produces the
open-road share, slow-zone shares and time at 70 km/h or more.

## Consequences

Times match riding experience far better and drive the right decisions. The
bend factors and default table are estimates, not calibrated on recorded rides;
calibration from recorded tracks is on the roadmap.

## Alternatives considered

Router time as is: systematically pessimistic. A commercial routing API:
better times, but cost and keys for every user.
