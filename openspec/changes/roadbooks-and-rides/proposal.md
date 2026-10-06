# Roadbooks and rides

## Why

A saved ride mixes the design of a loop with one day of riding it. Edits and
new dates create copies, the duplicate check blocks riding a loop again, a
cold day lowers a good road's rating, and a ride started away from home is
labelled with the home. Decision: ADR 0023, on top of versioned migrations
(ADR 0022).

## What changes

- **Roadbook**: the design (waypoints, legs, route line, road mix, cameras,
  stop candidates, road and leg ratings, road notes), edited in place with a
  version kept per edit. Copies only on request, as variants.
- **Ride**: a roadbook on a date (departure, start point, settings of the day,
  forecast, daylight, stop plan, traffic; then status, track, notes taken
  during the ride, rating of the day). Refreshable; stale when its roadbook
  changes.
- Overlap with a roadbook offers to ride it on the requested date instead of
  refusing.
- Roadbook ids are today's ride ids. "Ride 7" keeps meaning roadbook 7; a
  ride is addressed by roadbook and date.

## Vocabulary (folded into `openspec/project.md` when implemented)

- **Roadbook**: a loop or trip as designed. Numbered like saved rides today.
- **Ride**: a roadbook on one date, planned, ridden or cancelled.
- **Version**: a past state of a roadbook, kept on each edit.
- **Variant**: a roadbook copied from another on request.
- **Itinerary**: unchanged, the text presented to the rider.

## Impact

- Specs: `saved-rides` and `ride-feedback` (deltas here); `cli`,
  `mcp-server`, `route-exports`, `road-memory`, `ride-planning` adapt their
  wording and commands in the third pull request.
- Code: `src/store.ts` and a new `src/migrations.ts`; every library tool and
  command (save, show, list, edit, refresh, briefing, rate, notes, review,
  exports, ride map); the road memory's ride items.
- Data: one migration of every library, with a backup first.
- Evals: recorded sessions may see changed tool texts; re-recording is not
  needed unless a check fails.
