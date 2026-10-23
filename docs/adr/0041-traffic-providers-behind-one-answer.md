# 0041. Traffic providers behind one answer

- Status: accepted
- Date: 2026-10-23

## Context

The phone's traffic (ADR 0030) is served from TomTom's Flow Segment Data. Its price grows fast with use (about a thousand euros per
million requests past the free tier), TomTom has other endpoints that are cheaper per request (flow vector tiles), and other
providers exist. The phone must not have to change when the source does.

## Decision

The answer of `POST /traffic` is the contract: one level per point (free, slow, heavy, closed, unknown) and a ratio. Behind it the server
has a `TrafficProvider` (`flowAt(lat, lon)`), chosen by `TRAFFIC_PROVIDER` (default `off`: no traffic; `tomtom-flow` is the only source so far). The rounding, the
daily cap and the rate limit stand above the provider; a provider says if an answer may be kept for other riders (`cacheMs`) and if each
place costs a request (`metered`).
A provider answers `unknown` for a place it cannot tell; an unknown provider name stops the server at start with the list of known ones.
Another provider is one function and one entry in the list. None is added before there is a reason to.

TomTom is opt-in: the key is also the planner's, and TomTom's portal terms (read on 2026-10-23) forbid keeping results to serve several
users (clause 11.4), exclude navigation functionality unless agreed in writing (2.1), and limit an evaluation key to evaluation (2.2). So its
provider keeps nothing, and a host turns it on knowing their plan has to allow it. Open government data comes next, as providers of their own.

## Consequences

The phone, the spec of the answer and the guide do not depend on a vendor. Moving to flow tiles, or to another vendor when TomTom's price or terms
stop fitting, is a change in `src/traffic.ts` only. The cost of a provider is still its host's, with the host's key.

## Alternatives considered

Several providers at once with a fallback: more moving parts and two sets of terms for a service with a handful of riders. Leaving TomTom in
`TrafficFlow`: the first other provider would then mean rewriting the cache and the cap with it.
