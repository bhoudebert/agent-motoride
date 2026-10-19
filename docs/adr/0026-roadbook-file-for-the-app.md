# 0026. A roadbook file for the MobileMotoRide app

- Status: accepted
- Date: 2026-10-18

## Context

The MobileMotoRide app follows a roadbook on a phone and has no backend and no road data. The rider wants the speed
limit on screen at all times, a warning when above it, and warnings before fixed cameras. A GPX holds a line and
stops; the limits and cameras live in agentRide, where the limits exist only as aggregates (`speedLimits`) and the
cameras as a list in the ride's extras.

## Decision

Exporting a saved ride also writes a **roadbook file** (`docs/roadbook-file.md`, `.motoride.json`) next to the GPX.
It carries the line, the stops, a limit per stretch and the cameras. The line is the one traced by Valhalla, so the
stretches can refer to point indexes with no distance to agree on. The limit of a stretch comes from
`effectiveLimit`, extracted from the road statistics, so the statistics and the file never differ. Cameras carry a
bearing when OpenStreetMap gives one in degrees or as a compass point (the app compares it with the rider's direction), and
a direction only when it is `both`. A leg that cannot be traced is exported without limits and reported, never
dropped. The format is shared with the app and changes through its version number, in both repositories.

## Consequences

The app needs no road service to show limits, even offline. Export makes one trace request per leg more than before,
serially, on the public instance, under the fair use of ADR 0007. A ride exported before this change has no file
until it is exported again. Two repositories share a format: the copy here and the one in MobileMotoRide must be
kept in step.

## Alternatives considered

GPX extensions: other apps drop them and a per-stretch limit is awkward on points. Storing the limit profile in the
database at planning time: a migration and a backfill for every saved ride, for something recomputable at export.
A service answering the app: not built (MobileMotoRide ADR 0004).
