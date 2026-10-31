# MCP Server Specification

## Purpose

Expose the ride tools, the library and the planning guidance to any Model
Context Protocol client, so the client's model can plan on its own account.

## Requirements

### Requirement: Transport and state

The server SHALL speak the protocol over stdio with all logging on stderr (or, for several riders, over HTTP with a token: spec multi-user-server), SHALL hold one session context for its lifetime (routed trips, preferences, stop plans), SHALL create a run row at start and trace every tool call, and SHALL refuse ride tools until a start point is set (from the start point the rider saved, else `RIDE_HOME`, or `rideSettings`). What a rider sets with `rideSettings` (start point, motorways, the slow-zone, long-straight and fast-expressway targets) SHALL be kept in the rider's own library and applied at the start of their next sessions, over the host's environment (`RIDE_ALLOW_MOTORWAYS`, `RIDE_MAX_*_PCT`, `RIDE_HOME`), which stays the default for what a rider has not set; `rideSettings` with `reset` SHALL forget what was saved. A saved start point that cannot be found SHALL leave the start point unset, not fail the session.

#### Scenario: Settings kept for the next session

- **WHEN** a rider calls `rideSettings` with home "Lille" and `max30Pct` 7, and later opens a new session
- **THEN** the new session starts with start point Lille and a 30 km/h target of 7%, the other settings from the host's environment or the defaults, with no call; and after `rideSettings` with `reset` it starts from the host's defaults again

#### Scenario: No start point yet

- **WHEN** the server starts without `RIDE_HOME` and the client calls `calculateTrip`
- **THEN** the call fails with "No start point yet: call rideSettings with the rider's home first."
- **AND** after `rideSettings` with home "Lille", the ride tools run, each call traced on the session's run row

### Requirement: Tools

The server SHALL expose these 40 tools, the planner's own shared with the API
runner, and SHALL refuse a `saveRide` whose route id no tool of the session
returned. Each tool's behaviour is specified in the capability named next to it.

- Settings and help: `rideSettings` (start point, motorways, targets: this
  spec, "Transport and state"), `capabilities` and `planningGuide` (this spec,
  "Everything discoverable", "Client portability").
- Planning and routing: `listSavedRides` (the library near a place, read
  before planning: saved-rides, "Duplicate avoidance"), `recallArea`
  (road-memory), `searchRoads` and `calculateTrip` (route-analysis),
  `importRoute` (route-import), `scoutAreas` (ride-planning, "Scouts for new
  rides"), `reportScout` (this spec, "Client scouting when API scouts are
  off"), `checkItinerary` (ride-planning, "Itinerary checked by code").
- Finishing a ride: `getWeather`, `getDaylight`, `checkConditions` and
  `getTraffic` (weather-daylight, traffic), `getSpeedCameras`
  (external-lookups), `findStops` and `planStops` (stop-planning).
- Library: `saveRide`, `showRide`, `refreshRide` (full or stops only),
  `listRoadbooks` and `listRides` (paged with `page`), `planRide` (a ride from
  a roadbook on a day), `keepRideVersion`, `restoreRoadbook`, `copyRoadbook`,
  `cancelRide`, and the destructive `deleteRoadbook` and `deleteRide`,
  confirmed by the rider (saved-rides).
- Exports: `exportGpx`, `exportMarkdown` and `showRideMap` (route-exports).
- Ride day: `rideBriefing` (saved-rides, "Ride-day briefing").
- Feedback and memory: `addRideNote`, `reviewRide`, `rateStretch`,
  `listRatedRoads` and the destructive `deleteStretchRating` (ride-feedback),
  `rateRide` (saved-rides, "Ratings").

#### Scenario: Saving a route from elsewhere

- **WHEN** the client calls `saveRide` with a route id that no `calculateTrip` of this session returned
- **THEN** nothing is saved and the call fails with "Unknown routeId ...; it must come from calculateTrip in this session."

### Requirement: Prompts

The server SHALL expose 17 prompts that become slash commands: `plan-ride`, `commute`, `edit-ride`, `plan-from` (planning); `save-ride`, `show-ride`, `refresh`, `list-roadbooks`, `list-rides` (library); `export-gpx`, `export-md` (exports); `today` (ride day); `note`, `review`, `rate`, `rate-stretch` (feedback); `help`. Each, except `help` (rendered from the catalogue, no tool call), SHALL ask the client's model to call the matching tools with the rider's arguments. `plan-ride` SHALL carry the shared planning instructions, the rules for MCP (use the tools, plain text, end with a `Route:` line, settings changes through `rideSettings`), the request and the current settings.

#### Scenario: Settings change in the request

- **WHEN** the request says motorways are allowed
- **THEN** the model calls `rideSettings` before planning and the itinerary reports motorway use

### Requirement: Elicitation for the rider's decisions

When the client advertises form elicitation, `reviewRide` SHALL ask the rider in one form for the rating of each placed note (0-5, the proposal filled in) or its dismissal, and apply the answer; `saveRide` SHALL ask whether to save a copy when the ride duplicates a saved one. A declined or cancelled form SHALL change nothing. Without elicitation, the tools SHALL behave as before (review returned for the model to confirm in chat, duplicate refused with the instruction to ask).

#### Scenario: Review confirmed in a form

- **WHEN** the rider reviews a ride with two placed notes in a client with elicitation
- **THEN** one form shows both notes with their proposed ratings, and the submitted values are stored as road ratings

### Requirement: Resources

The server SHALL publish, as text: `ride://library` (the 20 newest roadbooks, one line each, ending with how to page through the rest with `listRoadbooks`), `ride://ride/{id}` (one roadbook, as `showRide` returns it, offered for the 20 newest and readable for any), and `ride://roads/rated` (road stretches, rides and legs rated, with their ratings).

#### Scenario: A large library

- **WHEN** the library holds 23 roadbooks
- **THEN** `ride://library` lists the 20 newest, newest first, and ends with "Page 1 of 2 (23 roadbooks). Next: call listRoadbooks with page 2"
- **AND** 20 `ride://ride/{id}` resources are offered, while `ride://ride/1` still opens

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

When scouts cannot run (`RIDE_SCOUTS=0` or no API credentials), the server instructions and the planning guidance SHALL say so and SHALL give the client a scout brief: start one subagent per area, in parallel, when the client can, each following the scout method (road memory first, then roads, route, weather) and reporting a route id; otherwise explore the areas itself. `scoutAreas` called anyway SHALL answer with the same guidance. When scouts can run, the guidance SHALL be unchanged. The terminal planner's instructions SHALL NOT change. Each subagent SHALL end by calling `reportScout` with its area, whether it found a loop, the routeId of its best loop if any, and a one-sentence verdict. The server SHALL take the figures (distance, open-road and 50-zone shares) and the place of the report from that routed loop, never from the text, or from the area's location when no loop was routed, and SHALL trace it as a scout's report, so the road memory learns it like an API scout's.

#### Scenario: A subagent's verdict is remembered

- **WHEN** a subagent scouting the Condroz reports no good loop, with the routeId of the loop it tried
- **THEN** the next `recallArea` around the Condroz lists that area as scouted, not found, with that loop's open-road share and its age

#### Scenario: Scouts off in Claude Code

- **WHEN** `.env` sets `RIDE_SCOUTS=0` and the rider asks for a new leisure ride
- **THEN** the planning guidance asks for parallel subagents with the scout brief, and their routes are presented with route ids of the session

### Requirement: Everything discoverable

Every capability SHALL be listed once, in a catalogue in the code (what it
does, what to say, the terminal commands, the shortcut, the MCP tools), and
the help SHALL be rendered from it: the `help` prompt, a read-only
`capabilities` tool for clients without slash commands and for "what can you
do?", `rides help` in the terminal, the guide's "Everything you can do" page
and the project site's list. A tool, a prompt, a `rides` command or a
`refine>` command missing from the catalogue SHALL fail the tests; a stale page
or site list SHALL fail the documentation check.

#### Scenario: A new feature

- **WHEN** a contributor adds an MCP tool or a terminal command without a catalogue entry
- **THEN** the tests fail, naming it

### Requirement: Run accounting

Each MCP session SHALL keep one run row with the model recorded as
`mcp-client` and the effort as `n/a`; the row SHALL hold the requests given to
`plan-ride`, `commute`, `edit-ride` and `planningGuide` (for a new ride), the tool calls, the
ride figures (distance, riding time, open-road, 50-zone and 30-zone shares,
motorway km) from the ride saved last in the session, else the last routed
trip, and as tokens and cost only those of the API scouts, priced at the scout
model. The client's own model and tokens are not visible to the server and
SHALL NOT be counted; `rides runs` SHALL say so for `mcp-client` rows.

#### Scenario: A session planned in the client

- **WHEN** the rider uses `plan-ride` and the client routes a loop, with API scouts off
- **THEN** the run row holds the request and the loop's distance, riding time and open-road and 50-zone shares, with model `mcp-client`
- **AND** it counts no tokens and no cost (no scout ran), and `rides runs` says the client's model is not visible

### Requirement: Reload

Code and `.env` changes SHALL require a full relaunch of the client; a new run row SHALL prove the new process.

#### Scenario: A code change

- **WHEN** a contributor changes a tool and relaunches the client
- **THEN** a new `mcp session` run row appears in `npm run rides -- runs`, proving the new process serves the tools
