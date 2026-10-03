# External Lookups Specification

## Purpose
Use free public map services without being blocked by them and without hiding
their failures.

## Requirements

### Requirement: Overpass access
Queries SHALL go one at a time from the process, through a list of instances (main, OSM France, the main service's second entry point) with pauses between retries, with a contact-style User-Agent. A response carrying a server remark SHALL count as a failure. Road searches SHALL use a bounding box, not a radius filter.

### Requirement: Lookups along a route
Cameras and stops SHALL be queried along the simplified route line in chunks of about 25 km with one regex filter per tag key; a chunk that fails SHALL be split in two and retried, down to a few km; results SHALL be merged by element id.

#### Scenario: Dense area
- **WHEN** a chunk through a city times out
- **THEN** its two halves are queried and the stops of both are returned

### Requirement: Caching
Results SHALL be cached in SQLite with per-tool lifetimes (roads 30 days, routes 7 days, cameras and stops 30 days keyed by route line, daylight and place names a year, weather an hour, traffic never) and a version key that invalidates old shapes.

### Requirement: Visible failure
A failed lookup SHALL produce a message naming the instances and reasons, SHALL be stored on the ride with its reason when gathered for a saved ride, and SHALL leave previous results in place.
