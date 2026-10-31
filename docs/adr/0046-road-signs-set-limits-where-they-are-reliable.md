# 0046. Road signs set limits where they are reliable

- Status: accepted
- Date: 2026-10-31

## Context

OpenStreetMap limits are missing or wrong in places, and the guesses of ADR 0045 stop at built-up land. Mapillary
publishes the speed limit signs detected in street-level photos, free with a token. Measured on the Peaceful loop
(74 km): 325 signs in the map cells it crosses but only 11 within 30 m of the line; 9 of them contradicted posted
limits, and by looking at their photos all of those were either roadworks signs (a triangle beside them), or signs of a
crossing road 15 to 17 m away. The permanent signs beside the line (70 where OpenStreetMap says 90) were right.
On a second ride, 40 signs stood by the road, almost all agreeing with OpenStreetMap, and several filled stretches
that were guesses. Mapillary has no "removed" state: a sign stays as last seen.

## Decision

With `MAPILLARY_ACCESS_TOKEN` set, a limit sign sets the limit of the stretch it stands beside, over OpenStreetMap's,
when it is within 12 m of the line, faces along the road in either direction (within 35 degrees of its axis, read from
the sign's `aligned_direction`), was last seen within two years, has no road works marker within 40 m (a roadworks
warning or an end-of-works sign, which Mapillary detects too) and agrees with the other such signs on the stretch. A
roundabout's ring takes none. The stretch is `posted: true`, `source: "sign"`; the export lists every place a sign
overrode OpenStreetMap, with both values. No image is read. Without a token nothing changes, like the TomTom key.

## Consequences

Roadbook files get correct limits where signs exist and are photographed, and the export shows where OpenStreetMap
is wrong, so it can be fixed at the source. Coverage is patchy and a permanent change nobody has photographed yet is
missed. A sign removed after its last photo can still override, within the two year window. One map request per 0.05
degree cell and one per sign near the line, kept in memory. Mapillary's terms apply to whoever runs the export.

## Alternatives considered

Reading the photos with a vision model: costs money and time per sign, and the data already tells works from
permanent signs. Filling only guesses and never overriding OpenStreetMap: leaves a permanent 70 shown as 90.
Town entry and exit signs (`built-up-area`), which Mapillary also detects: promising, but they need a travel
direction and are not built yet.
