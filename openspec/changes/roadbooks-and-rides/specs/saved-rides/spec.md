# Saved Rides: delta

## ADDED Requirements

### Requirement: Roadbooks and rides

The library SHALL keep **roadbooks** (the design of a loop or trip) and
**rides** (a roadbook on one date). A roadbook SHALL hold the waypoints, legs,
route line, grid footprint, road mix, preferences used, cameras and stop
candidates, its rating and notes, and its versions. A ride SHALL hold its
roadbook and the version it uses, date, departure, start point, settings of
the day, forecast, daylight, stop plan, traffic, status (planned, ridden,
cancelled), recorded track, notes and rating. There SHALL be at most one ride
per roadbook and date.

#### Scenario: Same loop, two Saturdays

- **WHEN** the rider rides roadbook 7 on two dates
- **THEN** the library holds one roadbook and two rides, each with its own forecast and stop plan

### Requirement: Editing a roadbook

A change to a roadbook SHALL route it again and replace its design in place,
keeping the previous state as a version with the request that changed it.
Planned rides of the roadbook SHALL move to the new version with their day
data marked stale; ridden rides SHALL keep their version. The rider SHALL be
able to return to a version, and to copy a roadbook as a variant under a new
id.

#### Scenario: Longer loop

- **WHEN** the rider asks to make roadbook 7 50 km longer
- **THEN** roadbook 7 has the longer route and one more version, and no new roadbook is created

### Requirement: Migration of existing libraries

Existing libraries SHALL be migrated once: each saved ride becomes a roadbook
with the same id; a dated one also becomes a ride with its day extras; the
ride's rating and notes go to the roadbook; notes taken during a ride go to
the matching ride, created when missing; a parent link becomes "variant of".
A backup SHALL be written before.

## MODIFIED Requirements

### Requirement: Saving

A roadbook SHALL be saved only on request, from a route id routed in the
session, under a name (default the planner's title), with a first ride when
the plan has a date. Saving after a change to a saved roadbook SHALL update it
with a new version (Requirement "Editing a roadbook").

### Requirement: Extras gathered after save and on refresh

Route-bound extras (cameras, fuel and café candidates) SHALL be stored on the
roadbook and gathered again when its route changes. Day-bound extras
(daylight, forecast, stop plan, traffic) SHALL be stored on the ride and
gathered at save, on refresh and in the briefing. A lookup that fails SHALL
keep the previous result and record the reason; the view SHALL show it.

### Requirement: Duplicate avoidance

Candidates sharing 70% or more of their grid cells with a roadbook SHALL be
rejected as new designs unless repeats are allowed; the planner SHALL offer to
ride that roadbook on the requested date instead. 40% or more SHALL be
mentioned as similar.

#### Scenario: Same request twice

- **WHEN** a plan reproduces a saved roadbook
- **THEN** the planner names it and offers a ride of it on the requested date

### Requirement: Ratings

Roadbooks and their legs SHALL be rateable 0 to 5 with a note; 0 means never
again. These ratings, and road ratings, SHALL steer planning as before. A ride
SHALL be rateable 0 to 5 for the day; a ride's rating SHALL NOT count in the
rated-roads check or mark a road in the road memory.

### Requirement: Ride-day briefing

`today [roadbook]` SHALL take the ride of that roadbook dated today, else the
next planned ride, refresh its day data and report as before, ending with GO,
GO with caution or NO-GO and the reasons. It SHALL make no model call.
