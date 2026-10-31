# Architecture decision records

Why the system is shaped the way it is. Behaviour is specified in
`openspec/specs/`; these records hold the reasons. New records use
`template.md` and the next free number; an accepted record is superseded,
not rewritten.

| #                                                              | Decision                                                                         | Status   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)                  | Record architecture decisions                                                    | accepted |
| [0002](0002-agent-with-deterministic-tools.md)                 | An agent decides, deterministic tools supply every fact, code enforces the rules | accepted |
| [0003](0003-sqlite-single-file.md)                             | One SQLite file for rides, runs, traces and cache                                | accepted |
| [0004](0004-two-modes-shared-tools.md)                         | Two execution modes over one tool definition: API and MCP                        | accepted |
| [0005](0005-scouts.md)                                         | Parallel scouts for new rides, optional                                          | accepted |
| [0006](0006-riding-time-model.md)                              | Riding time from speed limits and curvature, not from the router                 | accepted |
| [0007](0007-public-services-politely.md)                       | Use free public data services, politely and visibly                              | accepted |
| [0008](0008-route-ids-and-structured-answers.md)               | Route ids as handles; structured final answer in API mode                        | accepted |
| [0009](0009-default-model.md)                                  | Sonnet as the default planner model                                              | accepted |
| [0010](0010-tooling.md)                                        | TypeScript 7 native compiler beside the TypeScript 6 API; ESLint and Prettier    | accepted |
| [0011](0011-commits-and-releases.md)                           | Conventional Commits, squash merges, automated releases                          | accepted |
| [0012](0012-rate-roads-from-notes-and-tracks.md)               | Rate road stretches from time-stamped notes and recorded tracks                  | accepted |
| [0013](0013-evals-recorded-once-replayed-free.md)              | Evaluate the planner on recorded sessions, replayed for free                     | accepted |
| [0014](0014-code-checks-the-itinerary.md)                      | Code checks the itinerary; the planner gets one chance to fix it                 | accepted |
| [0015](0015-otlp-json-without-sdk.md)                          | Export sessions as OTLP/JSON, written without the OpenTelemetry SDK              | accepted |
| [0016](0016-import-by-rerouting.md)                            | Import a route file by re-routing it through waypoints, with measured fidelity   | accepted |
| [0017](0017-mcp-elicitation-and-resources-not-sampling.md)     | MCP: ask the rider through elicitation, offer rides as resources; no sampling    | accepted |
| [0018](0018-guide-with-vitepress.md)                           | A rider's guide built with VitePress from Markdown in the repository             | accepted |
| [0019](0019-ride-map-from-own-data.md)                         | Draw the ride map from the ride's own data, rendered with resvg                  | accepted |
| [0020](0020-road-memory-geo-and-keywords.md)                   | Road memory: what the app learnt, retrieved by place and by words                | accepted |
| [0021](0021-client-subagents-scout-when-api-scouts-are-off.md) | Let the client's subagents scout when API scouts are off                         | accepted |
| [0022](0022-versioned-schema-migrations.md)                    | Versioned schema migrations, applied in a transaction after a backup             | accepted |
| [0023](0023-roadbooks-and-rides.md)                            | Split the library into roadbooks (the design) and rides (a roadbook on a day)    | accepted |
| [0024](0024-ratings-by-precision-a-roadbook-rates-the-loop.md) | Ratings by precision: the narrowest wins, a roadbook rates the loop              | accepted |
| [0025](0025-long-straights-weigh-more-than-slow-zones.md)      | Measure long straights and weigh them above the 31-50 zones                      | accepted |
| [0026](0026-roadbook-file-for-the-app.md)                      | A roadbook file with limits and cameras for the MobileMotoRide app               | accepted |
| [0027](0027-one-instance-one-sqlite-file-per-user.md)          | One instance serves several riders, one SQLite file each, found by token         | accepted |
| [0028](0028-live-sharing-is-an-encrypted-relay.md)             | Live sharing is an encrypted relay the phone writes to and a web page reads from | accepted |
| [0029](0029-the-phone-joins-with-a-one-time-invitation.md)     | The phone joins with a one-time invitation, not a token in a QR code             | accepted |
| [0030](0030-traffic-comes-from-the-server.md)                  | Traffic comes from the server, with the host's TomTom key, not from the app      | accepted |
| [0041](0041-traffic-providers-behind-one-answer.md)            | Traffic providers behind one answer, chosen by the host                          | accepted |
| [0042](0042-traffic-from-open-government-data.md)              | Traffic from open government data, by country                                    | accepted |
| [0043](0043-an-own-valhalla-is-optional.md)                    | An own Valhalla is optional, chosen by one address                               | accepted |
| [0044](0044-specs-checked-in-ci.md)                            | Check the specs in CI and require a spec or docs change with code                | accepted |
| [0045](0045-untagged-town-roads-are-inferred-from-land-use.md) | Untagged town roads are inferred from land use                                   | accepted |
| [0046](0046-road-signs-set-limits-where-they-are-reliable.md)  | Road signs set limits where they are reliable                                    | accepted |
| [0047](0047-an-own-valhalla-runs-the-official-image.md)        | An own Valhalla runs the official image                                          | accepted |
