# 0021. Let the client's subagents scout when API scouts are off

- Status: accepted
- Date: 2026-10-06

## Context

Scouts explore two to four areas in parallel, each as its own model session
on the API key. Under an MCP client the planner already runs on the rider's
plan, and sampling, which would have run scouts there too, is unsupported in
Claude Code and deprecated (ADR 0017). With `RIDE_SCOUTS=0` or no key, the
client's model explores every area itself, one after the other: slower, and
a narrower search in practice.

Claude Code can run subagents in parallel on the rider's plan, and they reach
the same MCP server, so a route they compute has a route id the planner can
present and save.

## Decision

- `RIDE_SCOUTS` and the key stay the switch. When API scouts can run, nothing
  changes.
- When they cannot, the MCP server says so in its instructions and in the
  planning guidance, and gives the client a scout brief: if it can run
  subagents in parallel, it starts one per area with that brief (the same
  method as the API scouts: memory first, then roads, route, weather, a short
  report with a route id); otherwise it explores the areas itself, as before.
  `scoutAreas` called anyway answers with the same guidance.
- MCP only. The terminal planner always has API scouts; its instructions and
  the refusal text in `src/scouts.ts` are unchanged, so the recorded evals
  stay valid.

## Consequences

Parallel scouting at no API cost in Claude Code. It depends on the client: a
client without subagents explores alone, and the client's model decides how
closely it follows the brief. Rider rules stay enforced in code by
`calculateTrip` and `checkItinerary`, whoever calls them. Subagents use more
of the rider's plan quota. Their road searches reach the road memory; their
verdicts do not, since only API scouts' reports are traced as scout answers.

## Alternatives considered

Sampling: unsupported and deprecated (ADR 0017). A new `RIDE_SCOUTS=client`
value: nothing for it to switch, since the subagents are only guidance to the
client. Hiding `scoutAreas` when it cannot run: would change the tool list
per environment and break clients that cached it.
