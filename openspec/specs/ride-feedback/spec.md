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
ride dated today, else to the most recently saved roadbook. The note SHALL
belong to the ride of the day it was given, which is then marked ridden.

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

The ride of the track's day SHALL be marked ridden with the track's path,
created when the roadbook had none that day; notes SHALL be placed on the
route of the ride they were left on, and confirmed road ratings stored on the
roadbook.

#### Scenario: Detour

- **WHEN** the track leaves the plan for 6 km
- **THEN** the review lists the detour with its road and length and offers to rate it

### Requirement: Review without a track

Without a track, the review SHALL place notes on the planned route by elapsed
time since departure, at the plan's pace without stops, and mark them
approximate. A note outside the planned riding time is reported, not placed.

#### Scenario: Notes placed on the plan

- **WHEN** a 30-minute, 22 km ride left at 09:00 has a note "nice bends" given at 09:15 and a note "home" given at 12:20, and no track is given
- **THEN** "nice bends" is placed on 09:05-09:15, about km 7 of the plan, and marked approximate
- **AND** "home" is reported as outside the planned riding time and not placed

### Requirement: Rating a stretch directly

The rider SHALL be able to rate a stretch of road they rode, outside any
roadbook, from two places (and optional places between): `rides rate-stretch
"<from>" "<to>" <0-5> [note] [--via "<place>"]` and the MCP tool
`rateStretch`. The stretch SHALL be routed without motorways and stored as a
road rating (its roads, its cells, the rating, the rider's words), creating
no roadbook and no ride. The answer SHALL give its length, its main roads and a
map link so the rider can check it is the road they rode. A stretch under
300 m SHALL be refused, asking for the villages or a point between; one over
60 km SHALL be refused as a ride, to be saved as a roadbook and rated. Rated
roads SHALL be listable with an id (`rides rated`, `listRatedRoads`), and a
stretch rating removable after the rider confirms (`rides unrate-stretch <id>`,
`deleteStretchRating`).

#### Scenario: A nice stretch from a ride

- **WHEN** the rider rates the stretch from Rue de Longuesault 1, Tournai, to a point near Hollain 5, "very nice"
- **THEN** a 7 km road rating is stored with its roads, no roadbook is added, and the next plans around Tournai treat those roads as loved

#### Scenario: Two addresses next to each other

- **WHEN** the two places resolve 100 m apart
- **THEN** nothing is stored and the rider is asked for the villages or a point between

### Requirement: Road ratings steer planning

Road ratings (stretches) SHALL count in the rated-roads check of every routed
trip as the narrowest ratings (saved-rides, "Ratings by precision"): 0 or 1
avoid, 4 or 5 loved. A stretch SHALL keep its two ends as coordinates (from the
route for a directly rated stretch, from its first and last squares for a
reviewed note), returned by the road memory with loved and avoided stretches.

#### Scenario: A bad stretch in a loved roadbook

- **WHEN** a roadbook rated 5 contains a stretch rated 0
- **THEN** the next routed trip counts the stretch's roads as avoided and the rest of the roadbook as loved
- **AND** the road memory around the place returns loved and avoided stretches with their two ends as coordinates

### Requirement: Nothing to remember

Rides with pending notes SHALL be announced when the CLI menu opens and in the
MCP help and settings text.

#### Scenario: A note waiting

- **WHEN** one note on roadbook #1 is not reviewed yet
- **THEN** the CLI menu shows "1 ride note waiting for review (roadbook #1)" with the review command, and the MCP settings text asks to offer `reviewRide`

### Requirement: Limit proposals from an uploaded ride

For an uploaded ride (ADR 0054) that followed a roadbook of the library, the system SHALL propose lower limits for stretches whose planned limit was a guess or inferred. It SHALL NOT propose a change for a limit posted by OpenStreetMap or given by a sign, and SHALL NOT propose a higher limit than the planned one. A stretch SHALL be proposed only where the rider's moving points (above 5 km/h) cover at least 15 s, the 85th percentile is at most 8 km/h above the median, and the 85th percentile is at least 20 km/h below the guess; the proposed limit SHALL be the smallest of 30, 50, 60, 70, 80, 90 not below the 85th percentile minus 3 km/h. Each proposal SHALL give the place, the guess, and the speed held. Nothing SHALL change until the rider confirms; a confirmed correction SHALL be kept in the library by place (the road, either way) and replace the guess in every roadbook that passes there, and a rejected one SHALL not be proposed again for that place.

#### Scenario: A steady 50 on a guessed 80

- **WHEN** a ride holds 49 to 51 km/h for 30 s on a stretch planned at a guessed 80
- **THEN** a proposal of 50 is listed, with the speed held
- **AND** the roadbook keeps 80 until the rider confirms

#### Scenario: Faster than planned or on a posted limit

- **WHEN** a ride holds 66 to 68 km/h on a stretch planned at an inferred 50, or 45 km/h on a posted 80
- **THEN** no proposal is made
