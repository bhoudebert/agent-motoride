# Roadbooks and Rides Specification (saved-rides)

## Purpose

Keep rides the rider wants to keep, make later planning different from them,
learn from ratings, and hold everything needed to ride them again.

## Requirements

### Requirement: Library storage

The library SHALL be one SQLite file whose schema version is stored in it. On
open, pending migration steps SHALL run once each, in order, each in a
transaction with its version bump, so that a failing step leaves the file
unchanged. Before the first pending step on an existing file, a copy SHALL be
written next to it (`<file>.bak-v<version>`). A library newer than the app
SHALL be refused without being changed. A second process opening the file
during a migration SHALL wait for it.

#### Scenario: Migration fails midway

- **WHEN** a step fails after changing some tables
- **THEN** the library is at its previous version with its previous content, and the error names the step and the backup

### Requirement: Saving

A ride SHALL be saved only on request, from a route id routed in the session, under a name (default the planner's title). Saving again after a change SHALL create a new version linked to its parent; nothing SHALL be overwritten. Stored: name, home, date, departure, waypoints, legs, speed profile, preferences actually used (including the motorway setting of that trip), requests, itinerary text, map link, route line, 500 m grid footprint, session usage.

#### Scenario: Save with an unknown route id

- **WHEN** the route id was not routed in this session
- **THEN** the save is refused

### Requirement: Extras gathered after save and on refresh

Right after a save, and on every `refresh`, the system SHALL gather and store daylight, the forecast (within range), fixed cameras, fuel and café shortlists and the stop plan. A lookup that fails SHALL keep the previous result and record the reason; the view SHALL show it.

### Requirement: Refresh

`refresh` SHALL re-route the saved waypoints with the ride's own motorway setting, update distance, times, road mix, leg names and route line, then gather the extras. `refresh --stops` SHALL rebuild only the stop plan from the current bike profile, using cached candidates. Refresh SHALL NOT rewrite the itinerary text.

### Requirement: Duplicate avoidance

The planner SHALL read the library at the start; candidates sharing 70% or more of their grid cells with a roadbook SHALL be rejected unless repeats are allowed or the ride is the one being evolved; 40% or more SHALL be mentioned as similar. Saving a candidate that duplicates a roadbook outside the session's lineage SHALL be refused unless explicitly forced.

#### Scenario: Same request twice

- **WHEN** a plan reproduces a ride saved earlier
- **THEN** the save is refused with the duplicate named, and the planner offers to open the existing ride

### Requirement: Ratings

Rides and legs SHALL be rateable 0 to 5 with a note, from the CLI, the prompt, the menu and the `rateRide` MCP tool; 0 means never again. A rating SHALL count for the rest of the session at once, in the rated-roads check of the next routed trip. Legs rated 4 or 5 SHALL be offered as building blocks. Every routed trip SHALL report its share of distance on roads from rides or legs rated 0 or 1 (a leg's rating overriding the ride's); 10% or more SHALL make the loop invalid unless nothing else meets the hard limits, in which case the planner SHALL say so.

### Requirement: Editing a roadbook

Opening a roadbook SHALL seed the model with its structured data (not the old conversation); a change or new date re-routes and re-checks weather; a question is answered without replanning; overlap with the ride is expected.

### Requirement: Listing roadbooks and rides

The library SHALL be listable at two levels, 20 lines per page: roadbooks
(newest first, each with its ride count and next planned date) and rides
(by date, latest first, rides with no date yet last; each with its date,
departure, roadbook number and name, distance, time and status). Each page
SHALL end with its number, the page count and the total, and how to get the
next page: the command in the terminal, the page to ask for in MCP. A page
beyond the last SHALL say so and name the last page.

#### Scenario: Forty-five rides

- **WHEN** the rider lists rides and the library holds 45
- **THEN** the 20 latest are shown with "Page 1 of 3 (45 rides)" and how to see page 2

### Requirement: Planning a ride from a roadbook

The rider SHALL be able to plan a ride from a saved roadbook on a day, in a
sentence ("plan a ride from roadbook 7 on Saturday at 9", or "plan a ride on
Saturday" once a roadbook is in view) and by command (`rides plan <roadbook>
<day> [time]`, `/plan <day> [time]`, the MCP tool `planRide` and prompt
`plan-from`). Days SHALL be understood as dates, 17/10, today, tomorrow or a
weekday (English or French); times as 9, 9:30, 9h30 or 2pm; the departure
SHALL default to the roadbook's shown ride. It SHALL add a ride to that
roadbook, or update the ride already on that day, without copying the
roadbook; gather the day's data (daylight, forecast, conditions, stop plan)
onto that ride; and return the briefing with its verdict and the navigation
links. In the terminal it SHALL make no model call. A past day, an unknown
roadbook or a time that cannot be read SHALL be refused, adding nothing. A
sentence that asks for anything beyond a day and a time ("50 km longer") SHALL
go to the planner as a change.

#### Scenario: Same loop next Saturday

- **WHEN** the rider says "plan a ride from roadbook 7 on Saturday at 9"
- **THEN** roadbook 7 has one more ride, dated Saturday, leaving 09:00, with its forecast and stop plan, and no new roadbook exists

#### Scenario: In view

- **WHEN** the rider shows roadbook 7, then says "plan a ride on Sunday"
- **THEN** the ride is added to roadbook 7

### Requirement: Library management

The CLI SHALL list, show (plain or Markdown), rate, rate a leg, export, refresh, delete rides and clear the cache without a model call.

### Requirement: Ride-day briefing

`today [ride]` SHALL take the given ride, else the next dated ride, and SHALL report daylight and the return time with breaks, the stop plan rebuilt with opening hours at arrival, the forecast now at four points of the route, traffic at departure when available, and the stored cameras, ending with GO, GO with caution or NO-GO and the reasons. It SHALL make no model call.

#### Scenario: Rain likely

- **WHEN** a point of the route has 50% or more rain probability for the riding hours
- **THEN** the verdict is NO-GO with the rain risk listed
