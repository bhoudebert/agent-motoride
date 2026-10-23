# 0030. Traffic comes from the server, with the host's key

- Status: accepted
- Date: 2026-10-22

## Context

A rider would like to see on the map where the traffic is slow ahead, and decide by themselves whether to skip a point or
take another road. Real-time traffic has no open source: it means a provider with a key and a quota (TomTom has a free tier;
its terms are the key holder's to accept). A key in the app is a key in every copy of the app, and the app publisher would
answer for everyone's use. agentRide already uses TomTom, with the host's own key, for the planner.

## Decision

The multi-user server (ADR 0027) offers traffic when its host has a TomTom key. The phone sends up to eight points of the
road ahead to `POST /traffic` with its token; the server rounds them to about a kilometre, asks TomTom for the flow
there (Flow Segment Data, one request per cell, kept five minutes and shared between riders), and answers a level per point
(free, slow, heavy, closed, unknown). A daily cap of requests (`TRAFFIC_MAX_PER_DAY`, 600) keeps the host's quota safe. The
phone shows the levels as colour on the route and never changes a roadbook: agentRide chose the roads, the rider chooses
whether to follow. The server says in `/health` whether it has traffic, and the phone shows its Traffic switch only then.

## Consequences

Whoever hosts pays for, and answers for, their TomTom use: the project ships no key and takes no responsibility for a quota.
The phone has no key to leak. A server that answers the points learns about where the rider rides, to a kilometre, which live
sharing never lets it do: the guide says so and tells to use a server one trusts. Points are sampled every ten kilometres, so
a jam shorter than that is seen only if a point falls in it; this is an indication, not a map of traffic. The cell cache makes
the free tier last for a few riders; many riders on one key need a paid TomTom plan, which is the host's decision. TomTom's
Flow Segment Data may be replaced by other endpoints or providers (ADR 0041): only `src/traffic.ts` would change.

## Alternatives considered

A key in the app: extractable from the package, and the publisher answers for every rider's use. A traffic service run by the
project: a cost and a duty the project does not want, and one more place that knows where riders are. Traffic tiles (vector
or raster) drawn over the map: more precise to look at, but a rider's phone would send the tiles' keys or a proxy would have
to relay megabytes; and the tile layer is not decodable into the "slow in 12 km" the rider wants to hear. Open data only
(typical congestion by hour): there is none good enough to be worth the screen.
