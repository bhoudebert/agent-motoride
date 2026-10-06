# 0016. Import a route file by re-routing it through waypoints, with measured fidelity

- Status: accepted
- Date: 2026-10-06

## Context

Riders share routes as GPX or KML files (Kurviger, Calimoto, Liberty Rider,
clubs, forums). Saving such a file as is would give a ride with none of the
figures the library relies on: speed-limit profile, open-road share, slow
zones, surfaces, riding-time estimate, legs with names, cells for duplicate
and rated-road checks. Those come from routing.

## Decision

An imported line is reduced to waypoints (one about every 15 km, at most 6
to start) and routed with the motorcycle router like any planned loop. Then
each leg is compared with the stretch of the file it should follow (share of
the file's grid cells covered by the leg, one cell of tolerance); a leg under
85% gets a waypoint in the middle of its stretch, and the route is computed
again, up to three passes and the router's limit of 10 locations (a loop's return to the start is one). The result reports its fidelity:
the share of the file's line covered by the routed trip. The rider's rules
apply: with motorways forbidden, a file that uses one is routed around it and
the fidelity shows it.

## Consequences

An import is a normal routed trip: it can be presented, edited, checked,
saved and refreshed like any other, in every mode, and `rides import` does it
with no model at all. It is not the file's exact geometry: where the router
cannot be made to follow the file (a closed road, a private track), the
fidelity says so. A few seconds and up to four routing calls per import.

## Alternatives considered

Keep the file's geometry and map-match it for figures: exact, but the route
line, legs and links would then come from a different path than every other
ride, and editing it would mean routing anyway. Waypoints at every file point:
routers cap waypoints and would follow GPS noise.
