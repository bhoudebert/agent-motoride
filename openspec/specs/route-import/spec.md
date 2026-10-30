# Route Import Specification

## Purpose

Turn a route shared as a GPX or KML file into a ride of the library, with the
same figures, checks and extras as a planned one.

## Requirements

### Requirement: Read route files

The system SHALL read a GPX track (`trkpt`) or route (`rtept`) and a KML `LineString`, with the file's name when it has one. A file whose first and last points are within 500 m SHALL be a loop. Only `.gpx` and `.kml` files of at most 10 MB SHALL be read, and a file with fewer than two points SHALL be refused.

#### Scenario: A GPX loop from a friend

- **WHEN** the rider imports a `.GPX` file whose track "Col &amp; lacs" ends within 500 m of where it starts
- **THEN** its track points are read, its name is "Col & lacs" and it is treated as a loop

#### Scenario: Not a route file

- **WHEN** the rider gives a `.txt` file, a `.kml` over 10 MB, or a GPX with only waypoints (`wpt`)
- **THEN** it is refused: only .gpx and .kml are read, the file is over 10 MB, or there is no route line in it

### Requirement: Re-route with measured fidelity

The line SHALL be reduced to waypoints and routed with the rider's motorway setting. Each leg SHALL be compared with the stretch of the file it replaces; a leg covering less than 85% of it SHALL get a waypoint in the middle of the stretch and the route SHALL be computed again, up to three passes and the router's limit of 10 locations (a loop's return to the start is one). The result SHALL report its fidelity, the share of the file's line covered by the routed trip, and the waypoints used.

#### Scenario: The router takes a shortcut

- **WHEN** the first routing of an imported loop leaves the file's road on one leg
- **THEN** a waypoint is added in that stretch, the route is computed again, and the fidelity rises

### Requirement: Every mode

`npm run rides -- import <file> [name] [--force]` SHALL import and save without a model, refused like any save when it duplicates a roadbook. The `importRoute` tool SHALL give the planner (API and MCP) a routed trip with a route id, to present, edit, check and save like any other.

#### Scenario: Import in the terminal

- **WHEN** the rider runs `npm run rides -- import ~/Downloads/club.gpx` for a loop already in the library
- **THEN** the save is refused as a duplicate, with the hint to add `--force` to save it anyway

#### Scenario: Import through the planner

- **WHEN** the model calls `importRoute` with the path of a GPX file
- **THEN** it gets a route id with the trip's figures, the fidelity and the waypoints, which `getSpeedCameras`, `planStops`, `checkItinerary` and `saveRide` accept like one from `calculateTrip`
