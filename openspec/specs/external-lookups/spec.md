# External Lookups Specification

## Purpose

Use free public map services without being blocked by them and without hiding
their failures.

## Requirements

### Requirement: Overpass access

Queries SHALL go one at a time from the process, through a list of instances (main, OSM France, the main service's second entry point) with pauses between retries, with a contact-style User-Agent. A response carrying a server remark SHALL count as a failure. Road searches SHALL use a bounding box, not a radius filter.

#### Scenario: The main instance cuts a query short

- **WHEN** the main Overpass instance answers with a server remark (timeout or out of memory)
- **THEN** the answer is not used and the query is sent to OSM France, then to the second entry point after a pause
- **AND** a scout's road search waiting meanwhile is sent only once that query is done

### Requirement: Lookups along a route

Cameras and stops SHALL be queried along the simplified route line in chunks of about 25 km with one regex filter per tag key; a chunk that fails SHALL be split in two and retried, down to a few km; results SHALL be merged by element id.

#### Scenario: Dense area

- **WHEN** a chunk through a city times out
- **THEN** its two halves are queried and the stops of both are returned

### Requirement: Caching

Results SHALL be cached in SQLite with per-tool lifetimes (roads 30 days, routes 7 days, cameras and stops 30 days keyed by route line, daylight and place names a year, weather an hour, traffic never) and a version key that invalidates old shapes.

#### Scenario: Same loop routed again

- **WHEN** the same waypoints are routed again from the same start point within 7 days
- **THEN** the trip comes from the cache with no request to the router
- **AND** after a change of the cache version, the old entry is ignored and the router is asked again

### Requirement: Visible failure

A failed lookup SHALL produce a message naming the instances and reasons, SHALL be stored on the ride with its reason when gathered for a roadbook, and SHALL leave previous results in place.

#### Scenario: Overpass down during a refresh

- **WHEN** every Overpass instance fails while the cameras of a saved ride are refreshed
- **THEN** the error names each instance with its reason (e.g. `overpass-api.de: overpass-api.de responded 504: ...`)
- **AND** the ride keeps its previous cameras and records the failure under `cameras`
