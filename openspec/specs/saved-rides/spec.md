# Saved Rides Specification

## Purpose

Keep rides the rider wants to keep, make later planning different from them,
learn from ratings, and hold everything needed to ride them again.

## Requirements

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

The planner SHALL read the library at the start; candidates sharing 70% or more of their grid cells with a saved ride SHALL be rejected unless repeats are allowed or the ride is the one being evolved; 40% or more SHALL be mentioned as similar. Saving a candidate that duplicates a saved ride outside the session's lineage SHALL be refused unless explicitly forced.

#### Scenario: Same request twice

- **WHEN** a plan reproduces a ride saved earlier
- **THEN** the save is refused with the duplicate named, and the planner offers to open the existing ride

### Requirement: Ratings

Rides and legs SHALL be rateable 0 to 5 with a note, from the CLI, the prompt, the menu and the `rateRide` MCP tool; 0 means never again. A rating SHALL count for the rest of the session at once, in the rated-roads check of the next routed trip. Legs rated 4 or 5 SHALL be offered as building blocks. Every routed trip SHALL report its share of distance on roads from rides or legs rated 0 or 1 (a leg's rating overriding the ride's); 10% or more SHALL make the loop invalid unless nothing else meets the hard limits, in which case the planner SHALL say so.

### Requirement: Editing a saved ride

Opening a saved ride SHALL seed the model with its structured data (not the old conversation); a change or new date re-routes and re-checks weather; a question is answered without replanning; overlap with the ride is expected.

### Requirement: Library management

The CLI SHALL list, show (plain or Markdown), rate, rate a leg, export, refresh, delete rides and clear the cache without a model call.

### Requirement: Ride-day briefing

`today [ride]` SHALL take the given ride, else the next dated ride, and SHALL report daylight and the return time with breaks, the stop plan rebuilt with opening hours at arrival, the forecast now at four points of the route, traffic at departure when available, and the stored cameras, ending with GO, GO with caution or NO-GO and the reasons. It SHALL make no model call.

#### Scenario: Rain likely

- **WHEN** a point of the route has 50% or more rain probability for the riding hours
- **THEN** the verdict is NO-GO with the rain risk listed
