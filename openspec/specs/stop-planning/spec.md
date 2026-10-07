# Stop Planning Specification

## Purpose

Choose where the rider stops for fuel, a pause and lunch, from the bike's range
and the rider's rhythm, and put the stops where the phone will announce them.

## Requirements

### Requirement: Bike profile

The system SHALL keep one profile in the database: tank range, reserve, pause interval, max stint, lunch yes/no, with defaults 250 km, 40 km, 75 min, 90 min, yes. It SHALL be settable from the CLI (`rides bike`), the prompt (`/bike`) and MCP (`rideSettings`), and shown in the settings line.

### Requirement: Candidates along the route

Fuel stations, cafés, bakeries and restaurants within a detour of the route SHALL be found from OpenStreetMap along the exact line, spread over the whole route when the list is cut, with opening hours, address and detour, and cached 30 days per route line.

### Requirement: Plan

`planStops` SHALL place: the last fuel station before each fuel deadline (fuel at departure, then range, each minus the reserve), a café or bakery after the pause interval since the last stop of any kind, a restaurant where the ride crosses 12:30 when it spans midday; SHALL give each stop an arrival time, the return time with breaks, and warnings (no fuel before a deadline, no café in a long stint, no restaurant near midday). "Fuel at departure" SHALL be settable per ride.

#### Scenario: Short loop, full tank

- **WHEN** the loop is 188 km and the profile allows 303 km before fuel
- **THEN** no fuel stop is planned

### Requirement: Opening hours at arrival

When the ride date is known, each candidate SHALL be checked against its opening_hours tag at the arrival time; open places SHALL be preferred, unknown hours accepted, closed places chosen only as a last resort with a warning. Each planned stop SHALL carry "open", "closed" or "unknown" at arrival. A tag the reader cannot parse SHALL yield "unknown", never "open". A rule of days without hours ("Th-Su") SHALL mean "unknown" on those days and "closed" on the others, unless another rule covers them.

#### Scenario: Restaurant open Thursday to Sunday

- **WHEN** a lunch candidate is tagged "Th-Su" and the ride is on a Tuesday
- **THEN** it is closed at arrival, and an open or unknown restaurant is preferred

#### Scenario: Sunday bakery

- **WHEN** the arrival time is 10:19 on a Sunday and the tag says "Su 06:30-12:00"
- **THEN** the stop is marked open at arrival

### Requirement: Stop location in words

Every planned stop SHALL carry its name and where it is in words: street and village from the map's address, else the road and nearest village by reverse geocoding, else both combined.

### Requirement: Stops on the bike

Planned stops SHALL be waypoints in the navigation links and named stages and waypoints in the GPX, with their time. The export and the views SHALL state each stop's position in the GPX route point list for apps that show unnamed stages.
