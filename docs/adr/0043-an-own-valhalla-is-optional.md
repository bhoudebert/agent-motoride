# 0043. An own Valhalla is optional, chosen by one address

- Status: accepted
- Date: 2026-10-23

## Context

agentRide and the MotoRide phone route through the public Valhalla server (ADR 0008), a shared demo with rate limits (agentRide's planning
already meets 429s), no promise of service and a request to identify the apps that use it. A host with a VPS can run Valhalla for the countries that
matter (France and Belgium: a few GB of map data, tiles built in hours, 2 to 4 GB of memory to serve). Live traffic is a separate question: Valhalla
takes it only as data files supplied by the host.

## Decision

`VALHALLA_URL` names the Valhalla server agentRide uses; unset, it is the public one. It is read at each use and checked (http or https). The
compose files carry an optional `valhalla` service (the gis-ops image, behind the compose profile `valhalla`, nothing published) that builds the
tiles of France and Belgium with the admin boundaries (the roadbook's countries come from them) and no elevation. Turning it on is two lines:
`--profile valhalla` and `VALHALLA_URL=http://valhalla:8002`. Nothing changes for a host who does not. Next, as separate changes: `/route` and
`/trace` on the rider's server, so the phone can use the same engine when its server has one.

## Consequences

Planning is faster and has no shared rate limit; the host owns a rebuild (weekly is enough) that needs the memory of a build for a while. The
service was written from the image's documentation and not yet run here: the guide asks the host to report the real build time and memory.

## Alternatives considered

Bundling Valhalla in the image: a heavy image for everyone. A fixed own server: it would force the cost on every host. Live traffic into Valhalla
now: a project of its own.
