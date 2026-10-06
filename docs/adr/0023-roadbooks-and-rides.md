# 0023. Split the library into roadbooks (the design) and rides (a roadbook on a day)

- Status: proposed
- Date: 2026-10-06

## Context

A saved ride is one row holding two things with different lives:

- **the design**: waypoints, legs, route line, road mix, cameras, fuel and
  café candidates. Valid for months.
- **the day**: date, departure, start point, forecast, daylight, the stop
  plan with what is open at arrival, traffic, and afterwards the recorded
  track, the notes and how it went. Valid for one date.

Every edit or new date saves a new row linked to its parent, so the library
fills with near-copies; the duplicate check then gets in the way of riding a
loop again; a rating mixes the road ("cobbles, never again") with the day
("too cold"); and a ride started away from home is labelled with the home.

## Decision

Two levels, in the rider's words:

- **Roadbook**: the design, edited in place. Each edit keeps the previous
  version (waypoints, legs, route line, figures, the request that changed it),
  so an edit can be undone and a ride knows which version it used. Carries the
  route-bound extras (cameras, stop candidates), the road and leg ratings, and
  notes about the roads. A copy is made only when asked ("copy 7 as ..."),
  recorded as a variant of its origin.
- **Ride**: one roadbook on one date (0 to n per roadbook, one per roadbook and
  date): departure, start point, the settings of that day, and the day-bound
  extras (forecast, daylight, stop plan, traffic), all refreshable. Then what
  happened: planned, ridden or cancelled, the recorded track, the notes taken
  during the ride, and a rating of the day.
- **Itinerary** keeps its meaning: the text presented to the rider.

Rules that follow:

- Planning a new ride creates a roadbook and its first ride. Saving without a
  date keeps only the roadbook.
- Changing a roadbook ("make 7 50 km longer") routes it again and adds a
  version. Planned rides of that roadbook move to the new version and their
  day data is marked stale until refreshed; ridden rides keep the version they
  rode.
- A new date for a roadbook ("roadbook 7 on Sunday") adds or updates a ride;
  the briefing refreshes the ride only.
- A ride is addressed by its roadbook and its date ("7 on Saturday"), or by
  default the next planned one. "Ride 7" keeps meaning roadbook 7: it is how
  riders say it.
- Ratings split: road and leg ratings belong to the roadbook and feed the
  road memory and the rated-roads check; the day's rating belongs to the ride
  and never marks a road as bad.
- A candidate overlapping a roadbook is no longer a dead end: the planner
  offers to ride that roadbook on the requested date.

Migration (ADR 0022, step 2): each saved ride becomes a roadbook with the
same id, so every number the rider knows keeps working; a dated row also
becomes a ride with its day extras. The old ride rating and notes go to the
roadbook (they were written about the roads), notes taken during a ride to
the matching ride, created when missing. `parent_id` becomes "variant of":
copies are not merged automatically, since a branch has no single right
answer; a later "merge 12 into 7" can fold one into another's versions.

## Consequences

One entry per loop, edits without copies, a history of each loop's rides,
honest road ratings, and day data that is clearly perishable. The road memory
gets cleaner inputs. The cost: a migration of every library, every library
tool and command to adapt (CLI, MCP, exports, briefing, review), and two new
words for the rider to learn, kept close to what they already say.

Delivered in three pull requests: the migration system (ADR 0022), the new
tables with behaviour unchanged, then the commands and words.

## Alternatives considered

- Keep one table and edit rows in place: loses the history and still mixes
  the road and the day.
- Rides as plain dated copies with a shared "loop" id: the design is still
  copied on every date.
- Merge parent chains automatically during the migration: guesses which copy
  is the real one; left to the rider instead.
- "Itinerary" or "route" for the design: "itinerary" already names the text,
  "route" the routed trip of a session.
