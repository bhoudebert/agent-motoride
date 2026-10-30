# 0045. Untagged town roads are inferred from land use

- Status: accepted
- Date: 2026-10-30

## Context

Where OpenStreetMap has no speed limit on a road, the roadbook file assumed the
legal default of the country and region (80 in France, 90 in Wallonia), or 50
when Valhalla's density said built-up (6 or more). Measured on the Peaceful loop
(74 km), the density test caught none of the untagged stretches: 30 km were
assumed at 60 to 90, and 14 km of them lay inside OpenStreetMap's residential,
commercial or industrial land. In France and Belgium a road inside a town is 50
unless signed otherwise, so the app showed a limit far too high there. The same
measure on roads that are posted gave 72% inside such land at 50 or less and 2%
at 80 or more, so land use is a fair stand-in for a town.

## Decision

When the roadbook file is built, an edge with no posted limit and an assumed
limit above 50 whose line lies at least half inside land use residential,
commercial, retail or industrial is given 50, still `posted: false`, with the
optional stretch field `source: "inferred"`. The land is read from Overpass in
0.1 degree map cells, kept in memory. If the map service fails the defaults stand
and the export says so. Planning figures (slow-zone share, riding time) are not
changed by this decision.

## Consequences

The app shows 50 in towns where OpenStreetMap is silent, and can tell an inferred
limit from a country default. One more slow query per new map cell, at export,
share or first download only. Multipolygon relations are not read, so a few large
areas are missed; land use is not the legal limit, so a road along the edge of a
residential area can be misjudged either way. The planning statistics still
count those roads at the country default; aligning them is a later step.

## Alternatives considered

A lower country default when unsure: no way to tell towns from country, so open
road would be understated. Waiting for a sign source (Mapillary) or for limits
learned from recorded rides: better, and planned, but not available yet; this
catches the bulk with data already at hand. TomTom's limits: a paid key for every
host and licence limits on storing and passing on the values.
