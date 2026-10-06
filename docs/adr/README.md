# Architecture decision records

Why the system is shaped the way it is. Behaviour is specified in
`openspec/specs/`; these records hold the reasons. New records use
`template.md` and the next free number; an accepted record is superseded,
not rewritten.

| #                                                 | Decision                                                                         | Status   |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)     | Record architecture decisions                                                    | accepted |
| [0002](0002-agent-with-deterministic-tools.md)    | An agent decides, deterministic tools supply every fact, code enforces the rules | accepted |
| [0003](0003-sqlite-single-file.md)                | One SQLite file for rides, runs, traces and cache                                | accepted |
| [0004](0004-two-modes-shared-tools.md)            | Two execution modes over one tool definition: API and MCP                        | accepted |
| [0005](0005-scouts.md)                            | Parallel scouts for new rides, optional                                          | accepted |
| [0006](0006-riding-time-model.md)                 | Riding time from speed limits and curvature, not from the router                 | accepted |
| [0007](0007-public-services-politely.md)          | Use free public data services, politely and visibly                              | accepted |
| [0008](0008-route-ids-and-structured-answers.md)  | Route ids as handles; structured final answer in API mode                        | accepted |
| [0009](0009-default-model.md)                     | Sonnet as the default planner model                                              | accepted |
| [0010](0010-tooling.md)                           | TypeScript 7 native compiler beside the TypeScript 6 API; ESLint and Prettier    | accepted |
| [0011](0011-commits-and-releases.md)              | Conventional Commits, squash merges, automated releases                          | accepted |
| [0012](0012-rate-roads-from-notes-and-tracks.md)  | Rate road stretches from time-stamped notes and recorded tracks                  | accepted |
| [0013](0013-evals-recorded-once-replayed-free.md) | Evaluate the planner on recorded sessions, replayed for free                     | accepted |
| [0014](0014-code-checks-the-itinerary.md)         | Code checks the itinerary; the planner gets one chance to fix it                 | accepted |
| [0015](0015-otlp-json-without-sdk.md)             | Export sessions as OTLP/JSON, written without the OpenTelemetry SDK              | accepted |
