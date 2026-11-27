# External Lookups Specification

## Purpose

Use free public map services without being blocked by them and without hiding
their failures.

## Requirements

### Requirement: Overpass access

Queries SHALL go one at a time from the process, through a list of instances (main, OSM France, the main service's second entry point) with pauses between retries, with a contact-style User-Agent. A response carrying a server remark SHALL count as a failure. Road searches SHALL use a bounding box, not a radius filter. An instance that answers 401 or 403 (not open to this client) SHALL NOT be asked again by the process. After two queries in a row that no instance answered, Overpass SHALL be left alone for a minute and a query in that time SHALL fail at once, saying when to retry; a query cut short by its caller's deadline SHALL NOT count towards that.

#### Scenario: A mirror that is not open to us

- **WHEN** OSM France answers 403 "only available to white-listed usages"
- **THEN** it is named in the failure and not asked again by the process; the other instances are still tried

#### Scenario: Overpass at capacity

- **WHEN** every instance answers 502 "at capacity" for two queries in a row
- **THEN** the next query fails at once with "not asked again for N s" and sends no request, until the minute is over

#### Scenario: The main instance cuts a query short

- **WHEN** the main Overpass instance answers with a server remark (timeout or out of memory)
- **THEN** the answer is not used and the query is sent to OSM France, then to the second entry point after a pause
- **AND** a scout's road search waiting meanwhile is sent only once that query is done

### Requirement: Own Overpass instances

When `OVERPASS_URL` lists the host's own Overpass instances (addresses separated by commas, the path `/api/interpreter` added to an address that has none), every query SHALL go to all of them first, as each knows its own region, and their elements SHALL be merged by type and id. If any of them does not answer within 20 seconds (or the call's deadline), its answer being missing, the query SHALL be sent to the public instances instead, and an instance that failed for a reason other than a server remark SHALL be left alone for a minute, without delaying the queries meanwhile. A query SHALL never be answered from only some of the listed instances. Unset, only the public instances SHALL be used. An address that is not an http or https URL SHALL be refused with its name.

#### Scenario: Two regions, one answer

- **WHEN** `OVERPASS_URL` lists a Belgium and a northern-France instance and a route chunk crosses the border
- **THEN** both are asked, their elements are merged (an element on the border once), and the public instances are not asked

#### Scenario: One region's instance is down

- **WHEN** the France instance is importing (connection refused) and the Belgium one answers
- **THEN** the query is sent to the public instances, the answer is theirs, the failure names the France instance, and the next queries go to the public instances at once, without waiting for it, for a minute

### Requirement: Lookups along a route

Cameras and stops SHALL be queried along the simplified route line in chunks of about 25 km with one regex filter per tag key; a chunk that fails SHALL be split in two and retried, down to a few km; results SHALL be merged by element id. A lookup along a route SHALL answer within 75 seconds, the waiting its turn and the retries included (the client gives up on a call after 2 minutes): when the time is used, no further attempt starts and no chunk is split, and the tool fails saying the map service did not answer, so the itinerary can say the check was not done. A lookup asked again while the same one is running (same route line and same kinds) SHALL wait for the running one and not queue a second copy.

#### Scenario: The map service does not answer

- **WHEN** `getSpeedCameras` is called on a 130 km route while Overpass answers nothing
- **THEN** the call fails within 75 seconds with the instances and reasons, not after minutes of retries
- **AND** the same call repeated meanwhile waits for the running one instead of queueing a copy

#### Scenario: Dense area

- **WHEN** a chunk through a city times out
- **THEN** its two halves are queried and the stops of both are returned

### Requirement: Caching

Results SHALL be cached in SQLite with per-tool lifetimes (roads 30 days, routes 7 days, cameras and stops 30 days keyed by route line, daylight and place names a year, weather an hour, traffic never) and a version key that invalidates old shapes. Traffic SHALL instead be kept in memory per road cell of about 1 km, shared between riders, for its provider's cache time, and only for a provider that allows it (TomTom keeps nothing).

#### Scenario: Same loop routed again

- **WHEN** the same waypoints are routed again from the same start point within 7 days
- **THEN** the trip comes from the cache with no request to the router
- **AND** after a change of the cache version, the old entry is ignored and the router is asked again

#### Scenario: Traffic from a provider that allows caching

- **WHEN** a provider with a one-minute cache time is asked for two points in the same road cell within that minute
- **THEN** it is asked once, and asked again for that cell after the minute

### Requirement: Visible failure

A failed lookup SHALL produce a message naming the instances and reasons, SHALL be stored on the ride with its reason when gathered for a roadbook, and SHALL leave previous results in place.

#### Scenario: Overpass down during a refresh

- **WHEN** every Overpass instance fails while the cameras of a saved ride are refreshed
- **THEN** the error names each instance with its reason (e.g. `overpass-api.de: overpass-api.de responded 504: ...`)
- **AND** the ride keeps its previous cameras and records the failure under `cameras`
