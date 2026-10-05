# 0008. Route ids as handles; structured final answer in API mode

- Status: accepted
- Date: 2026-10-05

## Context

The model only sees summaries of routed trips. Saving or exporting a ride from
figures the model re-types would store prose, not data. A free-text reference
line at the end of the itinerary proved fragile.

## Decision

Every routed trip is registered in the session under an id (`r3`) and returned
with it. Saving, exporting and stop planning take that id and read the full
trip (geometry, legs, profile) from the session. In API mode the final answer
is validated by the API against a schema with the message and the route id it
presents. In MCP mode the itinerary ends with a `Route:` line and `saveRide`
takes the id explicitly, refusing unknown ids.

## Consequences

Saved figures always come from the routing result. An answer naming a route
that was never routed is shown but cannot be saved.

## Alternatives considered

Parsing figures from the itinerary text: unreliable. Saving the last routed
trip: wrong whenever the model compared several.
