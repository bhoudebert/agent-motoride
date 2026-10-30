# Route Analysis Specification

## Purpose

Route a list of waypoints on a motorcycle profile and describe the result in
the terms the rider cares about: distance, realistic riding time, open road,
slow zones, speed, main roads.

## Requirements

### Requirement: Routing

`calculateTrip` SHALL route waypoints in order (optionally back to the start) on the Valhalla motorcycle profile, SHALL exclude motorways whenever the session forbids them regardless of the model's input, and SHALL report `usesMotorway` and `motorwayKm` so a leak is visible. Each routed trip SHALL get a session route id and SHALL be registered for later save, export and stop planning.

#### Scenario: Motorways forbidden, model asks for them

- **WHEN** the session forbids motorways and the call passes `avoidMotorways: false`
- **THEN** the route is computed with motorways excluded and `motorwaysPermitted` is false

### Requirement: Speed-limit profile

For every road segment the system SHALL take the tagged limit; where none is tagged it SHALL count the segment as a 50 zone inside a built-up area and otherwise as open road at the legal default of its country and region (table in `src/tools/trip.ts`), capped by road class for minor lanes. The result SHALL give km and percent at 30 or less, 31-50, above 50, untagged open road (with the assumed limits), open-road share, and the longest 30 and 50 stretches by road name.

#### Scenario: Untagged road in Wallonia

- **WHEN** a secondary road in Wallonia has no maxspeed tag and lies outside a built-up area
- **THEN** it counts as open road at 90 km/h

### Requirement: Fast expressways

The profile SHALL report, apart from motorways, the km and share of fast expressways: segments that are not motorways and are either expressways (`trunk`) limited to 100 km/h or more, tagged or by default, or any road with a tagged limit of 100 km/h or more, with the longest stretches by road. A country's default alone SHALL NOT make a road outside `trunk` count.

#### Scenario: Former expressway now at 80

- **WHEN** a route uses an expressway at 110 for 20 km and a former expressway now posted 80 for 5 km
- **THEN** 20 km count as fast expressway and the 5 km do not

#### Scenario: Untagged country road in Germany

- **WHEN** a secondary road in Germany has no limit tagged (legal default 100)
- **THEN** it does not count as fast expressway

### Requirement: Long straights

The profile SHALL report the long straights of the route: runs that stay within 50 m of one straight line for 2 km or more, measured between their ends, with their km, their share of the distance and the four longest, each with its road (the ref before the street name), its leg and its starting point. A run SHALL end where the road leaves its corridor or turns back on itself.

#### Scenario: A straight road between two towns

- **WHEN** a route follows the D 953 from Saint-Amand-les-Eaux to Orchies
- **THEN** it reports a long straight of about 5.7 km on the D 953

#### Scenario: A bending road

- **WHEN** a road bends left and right every few hundred metres, more than 50 m either side
- **THEN** it reports no long straight

#### Scenario: Out and back

- **WHEN** a route rides 2.2 km along a straight road and back along it
- **THEN** it reports two long straights of 2.2 km, not one

### Requirement: Riding-time estimate

Riding time SHALL be estimated per segment as the limit scaled by a bend factor (about 95% straight, 80% flowing bends, 50% hairpins), capped at 85% of the limit in town, excluding stops and traffic. The router's own time SHALL be returned only as an upper bound.

#### Scenario: Straight road and town street

- **WHEN** a segment runs straight on a road limited to 80, and another runs straight through town at 50
- **THEN** the first is ridden at an estimated 76 km/h (95%) and the second at 42.5 km/h (capped at 85%)
- **AND** the router's own time is returned only as `routerUpperBoundTime` and per leg as router minutes

### Requirement: 70 km/h readings

Every routed trip SHALL report the share of riding time on roads limited to 70 or more and the share at an estimated 70 or more, and the share of distance with a limit of 70 or more.

#### Scenario: A straight 70 road

- **WHEN** a trip runs straight on a road limited to 70
- **THEN** its time counts toward the time on roads limited to 70 or more and its distance toward the distance limited to 70 or more
- **AND** it does not count toward the time at an estimated 70 or more, since it is ridden at about 66 km/h

### Requirement: Legs

Each leg SHALL carry from and to labels (the waypoint's resolved name; a waypoint given as coordinates is described by reverse geocoding, and keeps its bare coordinates only when that lookup fails), coordinates, distance, estimated minutes, average speed, router minutes, motorway flag and the main roads by km.

#### Scenario: Leg from a coordinate waypoint

- **WHEN** a loop is routed from Lille through a waypoint given as "50.33,4.88"
- **THEN** each leg carries a from and a to label with a place or road name for that waypoint, its coordinates, distance, estimated and router minutes, average speed, motorway flag and up to four main roads with their km

### Requirement: Road search

`searchRoads` SHALL return paved secondary and tertiary roads carrying a road number (`ref` tag) around a place, grouped by that number, of at least the minimum length (5 km by default), ranked by curviness (cumulative heading change per km, with the area median for scale), with end coordinates usable as waypoints, plus named mountain passes.

#### Scenario: Winding roads around a town

- **WHEN** `searchRoads` runs around Ciney and finds a paved tertiary road, a winding secondary road, a gravel road and an unnumbered lane
- **THEN** the gravel road and the unnumbered lane are left out and the paved roads come most winding first, with their curviness in degrees per km, the area median curviness, and from and to coordinates usable as waypoints
- **AND** named mountain passes in the area are listed with their elevation

### Requirement: Duplicate verdict

Every routed trip SHALL be compared with roadbooks and carry a verdict, listing up to three roadbooks sharing 20% or more of its cells: new, variant of the ride the session evolves, similar (40% or more shared cells), duplicate (70% or more of a roadbook outside the session's lineage, rejected unless repeats are allowed), "repeat of roadbook ..." for the same overlap when repeats are allowed, or "LIKE A LOOP THE RIDER DISLIKED" for 50% or more of a roadbook rated 0-1 outside the lineage when repeats are not allowed. Duplicate SHALL take precedence over disliked, and disliked over similar.

#### Scenario: Same loop as a saved roadbook

- **WHEN** a new session routes the Lille - Cassel loop already saved as roadbook #1
- **THEN** the trip's saved-ride verdict starts with "DUPLICATE" and names roadbook #1
- **AND** saving it is refused unless forced

#### Scenario: Big overlap with a disliked loop

- **WHEN** a trip shares 55% of its cells with roadbook #4, rated 1 "too many towns", and repeats are not allowed
- **THEN** its verdict starts with "LIKE A LOOP THE RIDER DISLIKED", names roadbook #4, its rating and the rider's note

#### Scenario: Repeats allowed

- **WHEN** repeats are allowed this session and a trip shares 80% of its cells with roadbook #1
- **THEN** its verdict reads "repeat of roadbook #1 ... repeats are allowed this session", not "DUPLICATE"

### Requirement: Road surface

Every routed trip SHALL report the distance on rough paved surfaces (cobblestones, setts) and on unpaved surfaces (compacted, gravel, dirt, path), with the longest such stretches by road name and leg, from the router's per-segment surface data. The planner SHALL avoid such stretches when an alternative exists and SHALL name them in the itinerary otherwise.

#### Scenario: Cobbled stretch

- **WHEN** a loop crosses 1.2 km of setts on a village road
- **THEN** the result lists 1.2 km rough paved with the road name and leg
