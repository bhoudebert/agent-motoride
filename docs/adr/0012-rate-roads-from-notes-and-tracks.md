# 0012. Rate road stretches from time-stamped notes and recorded tracks

- Status: accepted
- Date: 2026-10-05

## Context

Ratings steer planning (loved roads preferred, "never again" avoided), but the
existing ratings attach to legs, which only exist because of where the planner
put a waypoint. Riders remember roads, not legs. They also forget: asking for
a full review after the ride gets little back. And riders deviate from the
plan, so a rating placed on the planned route can land on a road that was not
ridden.

## Decision

- **Capture in the moment, place later.** During the ride the rider leaves
  short notes ("the last 10 minutes were awesome", "cobbles, never again")
  through any mode. A note stores its time, a look-back window (default 10
  minutes) and an optional rating; it does not need a position, which the
  session running on a computer cannot know.
- **The recorded track places the note.** When the rider hands over the GPX
  recorded during the ride, each note's time window selects the stretch of the
  track actually ridden, detours included. The road is identified by
  map-matching that stretch. Without a track, the note is placed on the plan
  by elapsed time and marked approximate.
- **Ratings belong to roads.** A confirmed rating is stored as a road rating:
  the stretch's 500 m grid cells, the road name, the rating and the note. Any
  future plan that crosses those cells sees it, in whatever ride.
- **The review asks little.** It proposes a rating for each note, flags
  detours (often worth a word), reports the rider's real pace against the
  estimate, and asks nothing else. Notes waiting for a track are announced
  when the app opens.
- **Every mode.** Notes and reviews are tools shared by the MCP server and the
  API planner, and CLI commands.

## Consequences

Ratings land on the road actually ridden and accumulate across rides. The
rider rates only what stood out, when it stood out. The cost: the rider must
record the ride with some app and export the GPX; the track file must reach the
machine running the app. Pace is measured but not yet fed back into the time
model (calibration remains a separate step).

## Alternatives considered

- **Rate legs after the ride:** legs are planning artefacts; memory fades.
- **Live position from the phone during the ride:** not available to a remote
  session; would require a phone app.
- **Map-match the whole track and ask about every road:** precise but turns
  feedback into homework.
