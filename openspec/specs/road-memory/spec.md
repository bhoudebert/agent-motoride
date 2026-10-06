# Road Memory Specification

## Purpose

Let every session start from what earlier ones learnt, so a region visited
before costs fewer scouts and road searches.

## Requirements

### Requirement: Memory derived from what is stored

The memory SHALL be derived from the library and the traces, never written by
hand: roadbooks and their legs with ratings and notes, rated road stretches,
scout verdicts per area (area, date, found, open-road and 50-zone shares,
verdict, location), and the winding roads of each road search (name or ref,
curviness, length, coordinates of both ends, date). It SHALL be kept current
incrementally and SHALL never hold weather.

### Requirement: Recall by place and by words

`recallArea` SHALL take a place and a radius (default 40 km) and return the
items within it: rides with their ratings, loved (4-5) and avoided (0-1)
stretches, scout verdicts with their age in days, and known winding roads
best first. With words, it SHALL also return the best keyword matches
(BM25, diacritics folded) wherever they are.

#### Scenario: Second visit to a region

- **WHEN** a region was scouted a week ago and found poor for open road
- **THEN** recalling it returns that verdict with its age, so the planner can choose another area without scouting it again

### Requirement: Consulted before scouting

The planner and the scouts SHALL be instructed to call `recallArea` before
scouting or searching roads in a region, to reuse known winding roads by
their coordinates, and to scout again an area recently found poor only for a
stated reason.
