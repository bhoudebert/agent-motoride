# Place Resolution Specification

## Purpose

Turn what the rider or the model types into coordinates, and coordinates back
into names a rider can read.

## Requirements

### Requirement: Forward geocoding chain

A location SHALL resolve as "lat,lon", else as a town through Open-Meteo, else as a street or address through Photon, else through Nominatim. A geocoder that is down SHALL NOT hide a match from the next one.

#### Scenario: Misspelled street

- **WHEN** the input is "Rue des Templier at LILLE"
- **THEN** it resolves to Rue des Templiers, Lille

### Requirement: Anchoring and disambiguation

Ambiguous names SHALL resolve to the match nearest the rider's start point, with town size weighed in so a real town beats a namesake hamlet. Fuzzy matches more than 500 km from the start SHALL be rejected with a message naming the closest text match.

#### Scenario: Nonsense input

- **WHEN** the input matches nothing near the start
- **THEN** the error says "Place not found near the start point" and names the far match

### Requirement: Reverse geocoding

Coordinates used as waypoints or stops SHALL be described as a road near a village, a pass or a settlement; postcodes, boundaries and bare numbers SHALL be rejected as labels. Results SHALL be cached permanently.
