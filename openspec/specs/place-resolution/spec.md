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

Ambiguous names SHALL resolve to a town of that very name before towns that only contain it (case, accents, hyphens and apostrophes aside: "Le Quesnoy", not Quesnoy-sur-Deûle), then to the match nearest the rider's start point, with town size weighed in so a real town beats a namesake hamlet. Fuzzy matches more than 500 km from the start SHALL be rejected with a message naming the closest text match.

#### Scenario: Nonsense input

- **WHEN** the input matches nothing near the start
- **THEN** the error says "Place not found near the start point" and names the far match

### Requirement: Reverse geocoding

Coordinates used as waypoints or stops SHALL be described from Photon's reverse geocoder, asked at about 100 m precision: the first road or pass, else the first settlement, else the first feature with a street, skipping postcodes and all-digit names, and the first feature as a last resort. A road SHALL read "<road> near <village>", anything else "<name>, <place>". When the lookup fails the label SHALL stay the bare coordinates. Labels SHALL be cached in memory and in SQLite, failures included; a cached all-digit label SHALL be asked again.

#### Scenario: Waypoint near a postcode

- **WHEN** a waypoint is given as coordinates and the reverse geocoder returns a postcode and the D 531 in Villard-de-Lans
- **THEN** the waypoint is labelled "D 531 near Villard-de-Lans", not the postcode
- **AND** the same point asked again later is answered from the cache

#### Scenario: Reverse geocoder down

- **WHEN** a waypoint is given as "50.331,4.882" and Photon does not answer
- **THEN** the waypoint is labelled "50.331,4.882" and the routing call still succeeds
- **AND** that label is cached like any other
