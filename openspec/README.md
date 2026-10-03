# Specifications

`specs/<capability>/spec.md` describes what the system does today, as
requirements with scenarios. `changes/` holds proposals that add or modify
requirements before they are implemented; once merged into the code, the
change is folded into the specs.

| Capability | Covers |
|---|---|
| ride-planning | The planner: request, constraints, scouts, structured answer, follow-ups, practical trips |
| route-analysis | Routing, speed-limit profile, riding-time estimate, open road and 70 km/h readings |
| place-resolution | Geocoding of towns and addresses, reverse geocoding of coordinates |
| weather-daylight | Forecasts along a route, sunrise and sunset, traffic check |
| saved-rides | Library: save, versions, ratings, duplicate detection, refresh, stored extras |
| stop-planning | Bike profile, fuel and pause planning, stop locations |
| route-exports | Navigation links, GPX, Markdown, QR and phone share page |
| external-lookups | Robustness and caching of public map services |
| mcp-server | Tools and slash commands for Claude Code and other MCP clients |
| observability | Runs, usage, cost, trace replay, benchmarking |
| cli | Start menu, refine prompt, commands, library management |
