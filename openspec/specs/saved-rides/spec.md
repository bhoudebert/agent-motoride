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
The planner SHALL read the library at the start; candidates sharing 70% or more of their grid cells with a saved ride SHALL be rejected unless repeats are allowed or the ride is the one being evolved; 40% or more SHALL be mentioned as similar.

### Requirement: Ratings
Rides and legs SHALL be rateable 1 to 5 with a note, from the CLI, the prompt and the menu. Legs rated 4 or 5 SHALL be offered as building blocks; rides or legs rated 1 or 2 SHALL be avoided.

### Requirement: Editing a saved ride
Opening a saved ride SHALL seed the model with its structured data (not the old conversation); a change or new date re-routes and re-checks weather; a question is answered without replanning; overlap with the ride is expected.

### Requirement: Library management
The CLI SHALL list, show (plain or Markdown), rate, rate a leg, export, refresh, delete rides and clear the cache without a model call.
