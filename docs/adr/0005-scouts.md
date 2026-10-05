# 0005. Parallel scouts for new rides, optional

- Status: accepted
- Date: 2026-10-05

## Context

Exploring several regions inside one conversation is slow and expensive: every
road search and routed loop is re-read on each later call, and cheaper settings
tend to settle on the first acceptable area.

## Decision

For a new leisure ride the planner calls `scoutAreas` with two to four areas.
Each scout is a separate small model session (Sonnet, low effort, three tools,
14 rounds at most) running in parallel, reporting one candidate with a route id
registered in the planner's session. Scouts are disabled with `RIDE_SCOUTS=0`
and are unavailable without an API key.

## Consequences

Measured once: four areas explored in about 100 seconds for about $0.21; the
same request without scouts produced three loops over the time limit. In MCP
mode scouts are the only part billed to the API key, hence the switch.

## Alternatives considered

Sequential exploration by the planner: cheaper per call, narrower search.
Sub-agents of the client (Claude Code agents): would run on the subscription,
but only in one client and not controllable from the server.
