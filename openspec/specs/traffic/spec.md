# Traffic Specification

## Purpose

Let the MotoRide phone show where the traffic is slow on the road ahead, with the host's own TomTom key, without the phone holding a key or talking to TomTom (ADR 0030). It informs the rider; it never changes a roadbook or re-routes.

## Requirements

### Requirement: The server offers traffic only with a key

The server SHALL offer traffic when `TOMTOM_API_KEY` is set and SHALL say so in its health answer (`traffic: true`); without a key it SHALL say `traffic: false` and answer `POST /traffic` with 503. The host, who holds the key, is the one who accepts TomTom's terms and answers for the quota; the phone holds no key.

#### Scenario: No key

- **WHEN** a server has no TomTom key and a phone asks for traffic
- **THEN** the answer is 503 "This server has no traffic source." and `/health` says `traffic: false`

### Requirement: Reachable through the proxy

The deployment examples (Caddy, the NixOS module, nginx) SHALL pass `/traffic` with the other public routes, the compose file and the NixOS module SHALL hand `TOMTOM_API_KEY` and `TRAFFIC_MAX_PER_DAY` to the container (the module through a file kept out of the Nix store), and a test SHALL fail when a route of the server is missing from an example.

#### Scenario: Behind Caddy

- **WHEN** a phone posts to `https://<domain>/traffic` through the example Caddyfile
- **THEN** the request reaches the server and is not answered 404 by the proxy

### Requirement: Flow at points of the road ahead

`POST /traffic` with the rider's token (spec multi-user-server) and `{points: [[lat, lon], ...]}` of one to eight points SHALL answer `{at, budget, points: [{lat, lon, level, ratio}]}`: for each point TomTom's flow at the road nearest to it (Flow Segment Data), as `ratio`, the current speed over the speed of an empty road, and a `level`: `free` (0.8 or more), `slow` (0.5 to under 0.8), `heavy` (under 0.5), `closed` (the road is closed), or `unknown` (no answer from TomTom, or a confidence under 0.5). A point TomTom could not answer SHALL be `unknown` and SHALL NOT fail the others. Anything else than one to eight valid points SHALL be refused with 400, a body over 2 KiB with 413, and a missing or wrong token with 401. A rider SHALL be allowed six requests a minute.

#### Scenario: A slow stretch

- **WHEN** a phone sends two points and TomTom reports 20 km/h on a road of 60 km/h at the first
- **THEN** the first point comes back `heavy` with ratio 0.33 and the second as TomTom says

### Requirement: The host's quota is kept

The points SHALL be rounded to a hundredth of a degree (about a kilometre) before TomTom is asked, and the answer of a cell SHALL be kept five minutes and shared by every rider of the server. The server SHALL ask TomTom at most `TRAFFIC_MAX_PER_DAY` times a UTC day (600 by default); past it the points not in the cache SHALL come back `unknown` and `budget` SHALL be `false`, until the next day. The key SHALL never be sent to a phone nor written to a log.

#### Scenario: The daily budget

- **WHEN** the budget of the day is used up and a phone asks for a cell not in the cache
- **THEN** it comes back `unknown` with `budget: false`, and TomTom is not asked

### Requirement: What the server learns

The points sent are on the road ahead of the rider, so a server that answers them learns roughly where the rider rides (to a kilometre); the guide SHALL say so, and that traffic is for a server one trusts (one's own, or a host's one trusts). TomTom learns only the cells, from the server's address with the host's key, never the rider's identity. Live sharing (spec live-sharing) is unchanged: it stays end-to-end encrypted.
