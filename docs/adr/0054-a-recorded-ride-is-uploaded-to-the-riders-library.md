# 0054. A recorded ride is uploaded to the rider's library

- Status: accepted
- Date: 2026-10-31

## Context

The phone records every ride (speed, altitude, time, and lean and G forces when the gauges were calibrated) as a GPX file on the phone only.
Nothing reaches the server, so the server cannot compare what was ridden with what it planned, a ride lost with the phone is lost, and the
limits it takes from OpenStreetMap and road signs (ADRs 0046, 0053) are never checked against a real ride. A rider cannot give those
corrections by hand: nobody remembers a limit from two hours ago, and most riders do not know the road names.

## Decision

The phone uploads a recorded ride when the rider asks, at the end of the ride or later from the list of rides:
`PUT /rides/<id>` with the GPX as it is (gzip allowed), `<id>` being the phone's own id for the ride (start time and name). The server
stores it in the rider's own library (a table, the GPX compressed in it), not as a file beside it, as ADR 0052 did for pushed roadbooks.

- **Idempotent.** The same id with the same content changes nothing; the same id with other content (a repaired file) replaces it. A retry
  never makes a second ride.
- **The roadbook is optional.** A ride says which roadbook it followed in its own GPX header (`origin`: app, number, name). When that is
  a roadbook of the rider's library, the ride is linked to it; a free-roaming ride has none and is kept all the same.
- **Server and phone are independent.** A rider can delete a ride on the server (`DELETE /rides/<id>`) without touching the phone, and a
  deletion on the phone never deletes it here. The phone warns before deleting a ride that was never uploaded.
- **Opt-in.** Nothing is sent without the rider's action; a track shows where a rider goes and when, so it is the rider's, readable only
  with their token.
- **Limits.** 25 MiB per ride, 10 uploads a minute, 200 rides per library.

What the server learns from a ride (proposed corrections of speed limits, from the speed held on a stretch against the limit in the
roadbook) is a later decision with its own record. Speed held is weak evidence, so those will only ever be proposals the rider confirms.

## Consequences

A ride survives the loss of the phone, and the server has real tracks to learn from. The library grows by about 1 to 4 MB per ride, hence
the cap. A free-roaming ride has no plan to compare with, so it can only be kept and listed until a later decision maps it to the road.
The rider can see and delete everything that was sent.

## Alternatives considered

Uploading every ride automatically: it would send a rider's whereabouts without their asking. Keeping the GPX as a file in a folder
beside the library: ADR 0052 showed that a second store means every tool must learn about it. Asking the rider to confirm the limits one
by one during or after the ride: they cannot remember them.
