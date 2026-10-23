# Traffic Specification

## Purpose

Let the MotoRide phone show where the traffic is slow on the road ahead, with the host's own TomTom key, without the phone holding a key or talking to TomTom (ADR 0030). It informs the rider; it never changes a roadbook or re-routes.

## Requirements

### Requirement: The server offers traffic only when a source is chosen

The server SHALL offer traffic only when its host chose a provider with `TRAFFIC_PROVIDER` and, for TomTom, set `TOMTOM_API_KEY`; it SHALL say so in its health answer (`traffic: true`). With no provider (`off`, the default) or no key for the one chosen, it SHALL say `traffic: false` and answer `POST /traffic` with 503. A TomTom key in the environment SHALL NOT turn traffic on by itself: the key is also the planner's. The host, who holds the key, answers for TomTom's terms and for the quota (ADR 0030).

#### Scenario: No key

- **WHEN** a server has no provider chosen, or TomTom chosen with no key, and a phone asks for traffic
- **THEN** the answer is 503 "This server has no traffic source." and `/health` says `traffic: false`

### Requirement: The provider is the host's choice

The flow SHALL come from the provider named by `TRAFFIC_PROVIDER` (default `off`; `tomtom-flow` is TomTom Flow Segment Data; ADR 0041), behind the same answer for every provider: a level and a ratio per point, `unknown` where the provider cannot tell. The rounding, the cache, the daily cap and the rate limit SHALL apply whatever the provider. A name that is not a known provider SHALL stop the server at start with the list of known ones.

#### Scenario: A mistyped provider

- **WHEN** `TRAFFIC_PROVIDER=tomtom` is set
- **THEN** the server does not start and says `Unknown TRAFFIC_PROVIDER "tomtom". Known: off, tomtom-flow.`

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

The points SHALL be rounded to a hundredth of a degree (about a kilometre) before TomTom is asked, and the server SHALL NOT keep TomTom's results to serve other riders (TomTom's terms forbid caching to serve several clients, clause 11.4): each request asks TomTom again. The server SHALL ask TomTom at most `TRAFFIC_MAX_PER_DAY` times a UTC day (600 by default); past it the points SHALL come back `unknown` and `budget` SHALL be `false`, until the next day. A provider that costs nothing per place and allows it MAY keep an answer for the time it declares. The key SHALL never be sent to a phone nor written to a log.

#### Scenario: The daily budget

- **WHEN** the budget of the day is used up and a phone asks for a cell
- **THEN** it comes back `unknown` with `budget: false`, and TomTom is not asked

### Requirement: What the server learns

The points sent are on the road ahead of the rider, so a server that answers them learns roughly where the rider rides (to a kilometre); the guide SHALL say so, and that traffic is for a server one trusts (one's own, or a host's one trusts). TomTom learns only the cells, from the server's address with the host's key, never the rider's identity. Live sharing (spec live-sharing) is unchanged: it stays end-to-end encrypted.
