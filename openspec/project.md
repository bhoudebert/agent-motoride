# Project Context

## Purpose
agentRide plans one-day motorcycle rides from a one-sentence request. A model
(Claude, or the model of an MCP client such as Claude Code) decides where to
look and what to propose; deterministic tools provide roads, routing, speed
limits, riding time, weather, daylight, cameras, stops, a library of saved rides
and exports. The code enforces the rider's hard rules and verifies what the
model presents.

## Tech Stack
- TypeScript on Node 24 (type stripping, no build step), SQLite via `node:sqlite`
- `@anthropic-ai/sdk` tool runner for the built-in planner; `@modelcontextprotocol/sdk` for MCP mode
- Data: OpenStreetMap via Overpass (roads, cameras, stops), Valhalla (routing, speed limits), Open-Meteo (weather, geocoding), Photon and Nominatim (addresses, reverse geocoding), TomTom (traffic, optional)

## Project Conventions

### Code Style
- Tools are plain async functions in `src/tools/`, with no SDK dependency; `src/tools/index.ts` holds the schemas and descriptions shared by the API runner and the MCP server.
- Rider rules are enforced in code (motorway exclusion, route-id validation), never left to the model.
- Standard output of the MCP server is reserved for the protocol; logging goes to stderr.
- Public map services are shared: serialise requests, chunk long queries, cache results, surface failures instead of hiding them.

### Architecture Patterns
- One `RideContext` per session: routed trips by id, preferences, usage, trace, stop plans.
- The model carries only ids (`r3`); the process holds the data behind them.
- Everything a ride needs after planning is stored on the ride row (`extras`), gathered at save and on `refresh`.

### Testing Strategy
- `npm test` (unit tests, fake services, no network), `npm run typecheck`, `npm run check` (environment for both modes), `npm run smoke` (live tools, no model), `npm run mcp:smoke` (protocol, no model).
- Model-side changes are tested against a local stub API first; a real run costs money and needs the rider's go-ahead. Never let a test reach the real API with the `.env` key.

### Git Workflow
- `data/`, `exports/`, `.env` are ignored. Specs live in `openspec/specs`; proposed changes in `openspec/changes`.

## Domain Context
- "Open road" is distance outside built-up areas and off motorways; the rider's yardstick is time at 70 km/h or more.
- Slow-zone shares (30 and 31-50 km/h) are targets to minimise, not pass/fail limits; motorways are forbidden by default and permitted per session.
- Riding time is estimated from speed limits and bends; the router's own time is an upper bound.
- Legal defaults for untagged roads depend on country and region (France 80, Wallonia 90, Flanders 70).

## Important Constraints
- Costs: every model call is billed; MCP mode runs on the client's subscription except scouts.
- Public Overpass instances throttle and block; the OSM France instance filters by User-Agent.
- No app can import a route into Waze; Google Maps accepts about ten points per link.

## External Dependencies
Open-Meteo, Valhalla (valhalla1.openstreetmap.de), Overpass (overpass-api.de, overpass.openstreetmap.fr), Photon (photon.komoot.io), Nominatim, TomTom Routing (key), Anthropic API (key) or Claude Code.
