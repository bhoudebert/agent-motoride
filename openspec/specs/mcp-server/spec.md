# MCP Server Specification

## Purpose

Expose the ride tools, the library and the planning guidance to any Model
Context Protocol client, so the client's model can plan on its own account.

## Requirements

### Requirement: Transport and state

The server SHALL speak the protocol over stdio with all logging on stderr, SHALL hold one session context for its lifetime (routed trips, preferences, stop plans), SHALL create a run row at start and trace every tool call, and SHALL refuse ride tools until a start point is set (from `RIDE_HOME` or `rideSettings`).

### Requirement: Tools

The server SHALL expose the planner's tools (`listSavedRides`, `getWeather`, `searchRoads`, `calculateTrip`, `getTraffic`, `getDaylight`, `getSpeedCameras`, `findStops`, `planStops`, `scoutAreas`) and the library tools `rideSettings`, `saveRide` (route id of the session only), `showRide`, `refreshRide` (full or stops only), `rideBriefing`, `exportGpx`, `exportMarkdown`, `listRoadbooks` and `listRides` (the rides by date), both paged with `page`, `planRide` (a ride from a roadbook on a day), `cancelRide`, and the destructive `deleteRoadbook` and `deleteRide`, confirmed by the rider.

### Requirement: Prompts

The server SHALL expose prompts that become slash commands: `plan-ride`, `commute`, `edit-ride`, `save-ride`, `export-gpx`, `export-md`, `show-ride`, `refresh`, `today`, `list-rides`, `help`. `plan-ride` SHALL carry the shared planning instructions, the rules for MCP (use the tools, plain text, end with a `Route:` line, settings changes through `rideSettings`), the request and the current settings.

#### Scenario: Settings change in the request

- **WHEN** the request says motorways are allowed
- **THEN** the model calls `rideSettings` before planning and the itinerary reports motorway use

### Requirement: Elicitation for the rider's decisions

When the client advertises form elicitation, `reviewRide` SHALL ask the rider in one form for the rating of each placed note (0-5, the proposal filled in) or its dismissal, and apply the answer; `saveRide` SHALL ask whether to save a copy when the ride duplicates a saved one. A declined or cancelled form SHALL change nothing. Without elicitation, the tools SHALL behave as before (review returned for the model to confirm in chat, duplicate refused with the instruction to ask).

#### Scenario: Review confirmed in a form

- **WHEN** the rider reviews a ride with two placed notes in a client with elicitation
- **THEN** one form shows both notes with their proposed ratings, and the submitted values are stored as road ratings

### Requirement: Resources

The server SHALL publish, as text: `ride://library` (the roadbooks, one line each), `ride://ride/{id}` (one roadbook, as `showRide` returns it, listed for every roadbook), and `ride://roads/rated` (road stretches, rides and legs rated, with their ratings).

### Requirement: Client portability

The server SHALL work with any MCP client over stdio. The rider SHALL get the same planning in plain words as through the slash commands: the planning guidance SHALL be available as the `planningGuide` tool, and the server instructions SHALL ask the client to call it before planning any new ride requested in plain words, in every client. Every tool SHALL declare all four MCP hints explicitly (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), matching what its handler does: lookups read-only, tools that write (settings, save, refresh, notes, review, exports) not, exports that may overwrite a file destructive, and local-only tools not open-world, so clients with annotation-based approval can let lookups run freely. Every tool SHALL be called by name in an end-to-end test through an MCP client.

#### Scenario: Codex CLI

- **WHEN** the server is registered in the user's Codex config (`npm run codex:register`; Codex reads no project-level MCP file) with `default_tools_approval_mode = "approve"`, and the rider asks for a ride in plain words
- **THEN** the model receives the server instructions, fetches the guidance with `planningGuide`, and plans with the tools without per-call confirmations

#### Scenario: Claude Code

- **WHEN** Claude Code connects from the project directory
- **THEN** the prompts appear as slash commands and the instructions reach the system prompt

#### Scenario: Plain words in Claude Code

- **WHEN** the rider types "plan me a ride this Saturday, under 250 km" without a slash command
- **THEN** the model calls `planningGuide` first and plans with the full guidance, as with `/mcp__ride__plan-ride`

### Requirement: Client scouting when API scouts are off

When scouts cannot run (`RIDE_SCOUTS=0` or no API credentials), the server instructions and the planning guidance SHALL say so and SHALL give the client a scout brief: start one subagent per area, in parallel, when the client can, each following the scout method (road memory first, then roads, route, weather) and reporting a route id; otherwise explore the areas itself. `scoutAreas` called anyway SHALL answer with the same guidance. When scouts can run, the guidance SHALL be unchanged. The terminal planner's instructions SHALL NOT change.

#### Scenario: Scouts off in Claude Code

- **WHEN** `.env` sets `RIDE_SCOUTS=0` and the rider asks for a new leisure ride
- **THEN** the planning guidance asks for parallel subagents with the scout brief, and their routes are presented with route ids of the session

### Requirement: Run accounting

MCP runs SHALL record the prompt requests, the ride figures from the saved or last routed trip, and the scouts' tokens and cost; the client's own tokens SHALL be reported as unknown.

### Requirement: Reload

Code and `.env` changes SHALL require a full relaunch of the client; a new run row SHALL prove the new process.
