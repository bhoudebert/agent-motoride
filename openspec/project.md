# Project Context

## Purpose

agentMotoride plans one-day motorcycle rides from a one-sentence request. A model
(Claude, or the model of an MCP client such as Claude Code) decides where to
look and what to propose; deterministic tools provide roads, routing, speed
limits, riding time, weather, daylight, cameras, stops, a library of roadbooks and rides
and exports. The code enforces the rider's hard rules and verifies what the
model presents.

## Tech Stack

- TypeScript on Node 24 (type stripping, no build step; TypeScript 7 native compiler for checks, TypeScript 6 API package for tooling), SQLite via `node:sqlite`
- `@anthropic-ai/sdk` tool runner for the built-in planner; `@modelcontextprotocol/sdk` for MCP mode
- Data: OpenStreetMap via Overpass (roads, cameras, stops), Valhalla (routing, speed limits), Open-Meteo (weather, geocoding), Photon and Nominatim (addresses, reverse geocoding), TomTom (traffic, optional)

## Project Conventions

### Code Style

- ESLint and Prettier (`eslint.config.js`, `.prettierrc.json`); `npm run quality` must pass before a pull request.
- Tools are plain async functions in `src/tools/`, with no SDK dependency; `src/tools/index.ts` holds the schemas and descriptions shared by the API runner and the MCP server.
- Rider rules are enforced in code (motorway exclusion, route-id validation), never left to the model.
- Standard output of the MCP server is reserved for the protocol; logging goes to stderr.
- Public map services are shared: serialise requests, chunk long queries, cache results, surface failures instead of hiding them.

### Architecture Patterns

- One `RideContext` per session: routed trips by id, preferences, usage, trace, stop plans.
- The model carries only ids (`r3`); the process holds the data behind them.
- What a roadbook needs is stored on it (route line, cameras, stop candidates); what a day needs on its ride (daylight, forecast, stop plan), gathered at save, on `refresh` and when a ride is planned from a roadbook.

### Testing Strategy

- `npm test` (unit tests, fake services, no network), `npm run typecheck`, `npm run check` (environment for both modes), `npm run smoke` (live tools, no model), `npm run mcp:smoke` (protocol, no model).
- Model-side changes are tested against a local stub API first; a real run costs money and needs the rider's go-ahead. Never let a test reach the real API with the `.env` key.

### Git Workflow

- Branches off `main`, pull requests reviewed by the maintainer, CI gate (`npm run quality` plus commitlint), Conventional Commits, release-please for versions and changelog.
- `data/`, `exports/`, `.env` are ignored. Specs live in `openspec/specs`; proposed changes in `openspec/changes`.
- No attribution trailers in commits or pull requests.

## Domain Context

- **Roadbook**: a loop or trip as designed and kept: waypoints, legs, route line, road mix, cameras, stop candidates, road and leg ratings. Numbers name roadbooks ("roadbook 7"; riders may say "ride 7").
- **Ride**: a roadbook on one day: date (or none yet), departure, start, forecast, daylight, stop plan, traffic, status (planned, ridden, cancelled), notes. Named by its roadbook and date ("Saturday's ride"); its id stays internal. "Plan a ride from roadbook 7 on Saturday" adds one, never a copy.
- **Itinerary**: the text presented to the rider.

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
