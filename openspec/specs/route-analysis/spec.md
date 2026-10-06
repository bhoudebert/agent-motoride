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

### Requirement: Riding-time estimate

Riding time SHALL be estimated per segment as the limit scaled by a bend factor (about 95% straight, 80% flowing bends, 50% hairpins), capped at 85% of the limit in town, excluding stops and traffic. The router's own time SHALL be returned only as an upper bound.

### Requirement: 70 km/h readings

Every routed trip SHALL report the share of riding time on roads limited to 70 or more and the share at an estimated 70 or more, and the share of distance with a limit of 70 or more.

### Requirement: Legs

Each leg SHALL carry from and to labels (place names, never bare coordinates), coordinates, distance, estimated minutes, average speed, router minutes, motorway flag and the main roads by km.

### Requirement: Road search

`searchRoads` SHALL return paved secondary and tertiary roads around a place, ranked by curviness (cumulative heading change per km, with the area median for scale), with end coordinates usable as waypoints, plus named mountain passes.

### Requirement: Duplicate verdict

Every routed trip SHALL be compared with saved rides and carry a verdict: new, similar (40% or more shared cells), duplicate (70% or more, rejected unless repeats are allowed), or variant of the ride the session evolves.

### Requirement: Road surface

Every routed trip SHALL report the distance on rough paved surfaces (cobblestones, setts) and on unpaved surfaces (compacted, gravel, dirt, path), with the longest such stretches by road name and leg, from the router's per-segment surface data. The planner SHALL avoid such stretches when an alternative exists and SHALL name them in the itinerary otherwise.

#### Scenario: Cobbled stretch

- **WHEN** a loop crosses 1.2 km of setts on a village road
- **THEN** the result lists 1.2 km rough paved with the road name and leg
