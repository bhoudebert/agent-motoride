# Specifications

`specs/<capability>/spec.md` describes what the system does today, as
requirements with scenarios.

## Which way to change a spec

**Default: edit `specs/` directly**, in the same pull request as the code. The
spec commit comes first (`docs(spec): ...`), then the code and the tests. One
pull request, reviewed together, nothing left to fold in later. CI validates
the specs and asks for a spec or docs change with any change under `src/`
(ADR 0044).

**A change proposal (`changes/<id>/`)** only when one of these holds:

- the feature spans several pull requests, so `specs/` must not describe it
  until it is all on `main`;
- the design should be agreed before any code: a first pull request holds
  only the proposal.

A proposal holds `proposal.md` (why and what), `tasks.md` (the steps),
optionally `design.md`, and delta specs under `changes/<id>/specs/<capability>/spec.md`
(`## ADDED`, `## MODIFIED`, `## REMOVED` or `## RENAMED Requirements`).
`openspec change` and `openspec instructions` help write one.

**Archive in the last pull request of the feature**, not in a pull request of
its own: `openspec archive <id>` folds the deltas into `specs/` and moves the
folder to `changes/archive/<date>-<id>/`, kept as the record of how it was
decided. `changes/archive/2026-10-07-roadbooks-and-rides/` is the example: a
schema migration across three pull requests (#59, #60, #64), archived in the
last one.

`openspec validate --all` checks the specs and any open proposal; CI runs it.
`openspec doctor` checks the setup (`config.yaml`).

## Capabilities

| Capability        | Covers                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| ride-planning     | The planner: request, constraints, scouts, structured answer, follow-ups, practical trips                 |
| route-analysis    | Routing, speed-limit profile, riding-time estimate, open road and 70 km/h readings                        |
| place-resolution  | Geocoding of towns and addresses, reverse geocoding of coordinates                                        |
| weather-daylight  | Forecasts along a route, sunrise and sunset, traffic check                                                |
| saved-rides       | Library: roadbooks and rides, save, plan a ride from a roadbook, lists, ratings, duplicates, refresh      |
| stop-planning     | Bike profile, fuel and pause planning, stop locations                                                     |
| route-exports     | Navigation links, GPX, Markdown, QR and phone share page                                                  |
| external-lookups  | Robustness and caching of public map services                                                             |
| mcp-server        | Tools and slash commands for Claude Code and other MCP clients                                            |
| observability     | Runs, usage, cost, trace replay, benchmarking                                                             |
| evaluation        | Eval cases, code graders, recorded sessions replayed for free, injection resistance                       |
| route-import      | GPX and KML files turned into routed rides, fidelity to the file, saved like any ride                     |
| road-memory       | What past sessions learnt (rides, ratings, scout verdicts, winding roads), recalled by place and by words |
| cli               | Start menu, refine prompt, commands, library management                                                   |
| ride-feedback     | Notes during the ride, review with a recorded track, road ratings                                         |
| traffic           | The phone's traffic ahead: open government data by default, TomTom as an alternative, through the server  |
| live-sharing      | A ride followed live by others: encrypted relay written by the phone, read by a web page                  |
| multi-user-server | One instance for several riders, one library each, found by token; enrolment of the phone                 |
