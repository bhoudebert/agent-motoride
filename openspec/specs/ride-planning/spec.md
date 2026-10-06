# Ride Planning Specification

## Purpose

Turn a rider's one-sentence request into an itinerary the rider can follow,
built only from tool results, within the rider's hard limits and preferences.

## Requirements

### Requirement: Request handling

The planner SHALL accept a free-text request plus a start point, road preferences, today's date and, optionally, a saved ride to work from, and SHALL send nothing to the model until the first message.

#### Scenario: New ride

- **WHEN** the rider asks for a leisure ride
- **THEN** the planner sends the request with the start point, preferences and date, and plans

#### Scenario: Open a saved ride without a request

- **WHEN** a saved ride is opened for editing
- **THEN** the prompt opens with the ride loaded and no model call is made until the rider types

### Requirement: Hard limits and targets

The planner SHALL treat distance caps, riding-time caps and "dry" as hard limits, and the 30 and 50 km/h zone shares as targets to minimise. When nothing satisfies every hard limit, it SHALL say so and offer the closest option naming the broken limit.

#### Scenario: No loop fits

- **WHEN** every candidate exceeds the time cap
- **THEN** the answer states that no loop fits and presents the closest one with the overshoot

### Requirement: Itinerary checked by code

Every itinerary SHALL be checked by code before it is shown: routed distance and riding time against the caps read from the rider's words, no motorway when forbidden, no repeat of a saved ride unless repeats are allowed, less than 10% on roads rated 0-1, the distance stated in the answer equal to the routed one within 1.5 km, and, while motorways are forbidden, less than 25% of fast expressway (roads that are not motorways, limited to 100 km/h or more). In API mode a failed check SHALL be sent back to the planner once, marked as an automatic check, unless the answer already acknowledges the breach; checks still failing after that SHALL be shown to the rider under the itinerary. In MCP mode the checks SHALL be available as the `checkItinerary` tool.

#### Scenario: Over the cap

- **WHEN** the rider asked for "under 200 km" and the itinerary routes 214 km without saying so
- **THEN** the planner is told "routed 214 km, over the 200 km limit" and answers again

#### Scenario: Impossible request

- **WHEN** the answer says the request cannot be met and presents the closest option
- **THEN** it is shown as is, without a retry

### Requirement: Rides from an image

The rider SHALL be able to attach images to a request (`--image`, `/image`; pasted in MCP clients): a photo of a paper map, a screenshot of a route, a list of places. The planner SHALL read the places on it in order, say what it read, route them by name with the tools, and finish the ride as usual; an unreadable image or one that is not a map SHALL be reported. Only PNG, JPEG, WebP and GIF images of at most 5 MB SHALL be accepted, checked by their content before any model call, and only their names SHALL be stored in the trace.

#### Scenario: Sketch of a loop

- **WHEN** the rider attaches a sketch of a loop through Bailleul, Cassel, Mont des Cats and Armentières
- **THEN** the itinerary routes those places in loop order and names them

### Requirement: Scouts for new rides

For a new leisure ride the planner SHALL first call `scoutAreas` with two to four areas; each scout SHALL run as its own model session with `recallArea`, `searchRoads`, `calculateTrip` and `getWeather` only, in parallel with the others, and report a candidate with a route id known to the session. The loop SHALL start and end at the start point the request names (`start`), and at the rider's home when it names none. Scouts SHALL NOT be used for edits, questions or practical trips, and SHALL be unavailable without API credentials or when `RIDE_SCOUTS=0`.

#### Scenario: Request starts elsewhere than home

- **WHEN** the home is Lille and the request asks for a loop from Thuin
- **THEN** every scout's brief names Thuin as the start and end point, and its loop is routed from there

#### Scenario: Scout failure

- **WHEN** one scout fails
- **THEN** the other reports are returned and the failure is listed in the notes

### Requirement: Facts only

The planner SHALL state only what tools returned and SHALL mark unverified parts as such when a tool fails or has no data source.

### Requirement: Structured final answer (API mode)

The built-in planner's final answer SHALL be validated by the API against a schema with `message` (text for the rider) and `ride` (route id, date, departure, name, or null for a plain answer). An answer naming a route id unknown to the session SHALL be shown with a warning and SHALL NOT be saveable.

#### Scenario: Question without replanning

- **WHEN** the rider asks a question about the itinerary
- **THEN** the answer has `ride: null` and the current itinerary stays on the table

### Requirement: Itinerary layout

The itinerary SHALL be plain text for a terminal: name and reason; departure, distance, estimated riding time, average speed, realistic total; open-road share, time at 70 km/h or more (both readings), motorway use, slow-zone shares against targets; daylight; numbered legs with town names (never bare coordinates), main roads, distance, time, average speed; weather by time of day; traffic or "not checked"; cameras; planned stops with times; navigation links; one alternative.

### Requirement: Follow-ups

A follow-up SHALL be treated as an edit of the current itinerary: keep what was not asked to change, reuse lookups, re-route and re-check weather for what changed, and answer with the full updated itinerary.

### Requirement: Practical trips

When the request is a practical trip (commute, arrive by a time), the planner SHALL route point to point, use motorways when permitted, skip road discovery and slow-zone optimisation, check weather and traffic for the travel hours, give the arrival time, and ignore saved-ride overlap.

### Requirement: Order of completion

Once a loop is chosen the planner SHALL run traffic, cameras and the stop plan on that loop, and reconsider departure or loop only when traffic or daylight demands it.
