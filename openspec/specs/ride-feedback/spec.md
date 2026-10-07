# Ride Feedback Specification

## Purpose

Let the rider say, during the ride, what was great or bad, place it on the road
actually ridden once the recorded track is available, and turn it into road
ratings that steer every later plan.

## Requirements

### Requirement: Notes during the ride

The system SHALL accept a note on a ride (a roadbook ridden on a day) from every mode (MCP tool and
prompt, `rides` command, refine prompt command): free text, an optional rating from 0 (never again) to 5,
and a look-back window in minutes (default 10). The note SHALL be stored with
the time it was given. Without an explicit ride, the note SHALL attach to the
ride dated today, else to the most recently roadbook.

#### Scenario: Quick note at a stop

- **WHEN** the rider says "the last 10 minutes were awesome" at 10:42
- **THEN** a note with window 10:32-10:42 is stored on today's ride
- **AND** the review proposes rating 5, read from "awesome"

### Requirement: Review with a recorded track

Given a roadbook and a GPX track with timestamps (a file on the machine that
runs the session), the review SHALL:

- place each pending note on the stretch of the track ridden during its window
  and name the road by map-matching that stretch;
- report detours: stretches of more than 2 km of the track that the plan does
  not cover, with their length and road;
- report the rider's moving pace against the plan's estimated pace;
- propose the note's rating for each placed stretch and, once confirmed, store
  a road rating (road name, grid cells, rating, note, ride) and mark the note
  reviewed. A rating the rider gave in the note wins; otherwise one is read
  from its words ("never again" 0, "awesome" 5), or the rider is asked. The
  rider may dismiss a note instead.

#### Scenario: Detour

- **WHEN** the track leaves the plan for 6 km
- **THEN** the review lists the detour with its road and length and offers to rate it

### Requirement: Review without a track

Without a track, the review SHALL place notes on the planned route by elapsed
time since departure, at the plan's pace without stops, and mark them
approximate. A note outside the planned riding time is reported, not placed.

### Requirement: Road ratings steer planning

Road ratings SHALL count in the rated-roads check of every routed trip like
leg ratings: 0 or 1 avoid, 4 or 5 loved.

### Requirement: Nothing to remember

Rides with pending notes SHALL be announced when the CLI menu opens and in the
MCP help and settings text.
