# 0061. The phone routes through its server

- Status: accepted
- Date: 2026-11-21

## Context

The phone called the public Valhalla (`valhalla1.openstreetmap.de`) directly for every route: the way to a roadbook's start, the
way back after a missed turn, and since the Go To offers several ways (MotoRide ADR 0053) three requests at once. The public
server is a community demo with no guarantee and a usage policy that does not expect an app in the stores. A host's own Valhalla
(compose service `valhalla`, port 8002 on the internal network) was reached only by agentRide's planner, never by the phone, and
the phone's server answered no `/route`.

## Decision

The server answers `POST /route` for a rider's token. It rebuilds the Valhalla request from a short list of fields (two to five
places with an optional heading, the motorcycle costing with `use_highways` and `shortest`, `alternates` up to 2) and never passes
the body on, so the token is not a way to use the host's Valhalla for anything else (isochrones, matrices, a bulk of requests). It
goes through `valhallaJson`, so a host with several Valhalla servers keeps the newest map and the failover. A rider has 30 routes a
minute. `/health` says `route: true` so a phone can tell. Valhalla stays unpublished.

The phone tries its server first and falls back to the public server when the server has no `/route`, is busy or is down; a
server without it is remembered until the app restarts so it is not asked on every route.

## Consequences

A phone with a server no longer depends on the public Valhalla, and the host's map is the one that routes (the same map as the
roadbook files). The host's Valhalla carries the phone's requests: they are small and rate-limited per rider. The fallback still
sends a destination to the public server when the rider's own cannot answer, as the phone did before. Entitlements per plan
(a daily number of routes) and avoiding zones (`exclude_polygons`) are left for later; each is one more field here.
