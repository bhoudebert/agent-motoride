# MCP Server Specification

## Purpose
Expose the ride tools, the library and the planning guidance to any Model
Context Protocol client, so the client's model can plan on its own account.

## Requirements

### Requirement: Transport and state
The server SHALL speak the protocol over stdio with all logging on stderr, SHALL hold one session context for its lifetime (routed trips, preferences, stop plans), SHALL create a run row at start and trace every tool call, and SHALL refuse ride tools until a start point is set (from `RIDE_HOME` or `rideSettings`).

### Requirement: Tools
The server SHALL expose the planner's tools (`listSavedRides`, `getWeather`, `searchRoads`, `calculateTrip`, `getTraffic`, `getDaylight`, `getSpeedCameras`, `findStops`, `planStops`, `scoutAreas`) and the library tools `rideSettings`, `saveRide` (route id of the session only), `showRide`, `refreshRide` (full or stops only), `exportGpx`, `exportMarkdown`, `listRides`.

### Requirement: Prompts
The server SHALL expose prompts that become slash commands: `plan-ride`, `commute`, `edit-ride`, `save-ride`, `export-gpx`, `export-md`, `show-ride`, `refresh`, `list-rides`, `help`. `plan-ride` SHALL carry the shared planning instructions, the rules for MCP (use the tools, plain text, end with a `Route:` line, settings changes through `rideSettings`), the request and the current settings.

#### Scenario: Settings change in the request
- **WHEN** the request says motorways are allowed
- **THEN** the model calls `rideSettings` before planning and the itinerary reports motorway use

### Requirement: Run accounting
MCP runs SHALL record the prompt requests, the ride figures from the saved or last routed trip, and the scouts' tokens and cost; the client's own tokens SHALL be reported as unknown.

### Requirement: Reload
Code and `.env` changes SHALL require a full relaunch of the client; a new run row SHALL prove the new process.
