# 0007. Use free public data services, politely and visibly

- Status: accepted
- Date: 2026-10-05

## Context

OpenStreetMap through Overpass, Valhalla, Photon and Nominatim are free public
instances with usage policies. They throttle, time out, and occasionally block
an address after heavy use; one instance filters by User-Agent.

## Decision

Requests to Overpass are serialised within a process, tried across instances
with pauses, sent with a contact-style User-Agent, and long route queries are
split into chunks of about 25 km that are halved again when a dense area times
out. A response carrying a server remark counts as a failure. Results are
cached in SQLite with per-tool lifetimes. A failed lookup is reported and
stored with its reason, and a previous result is kept rather than erased.

## Consequences

The app runs with no keys at all and stays within fair use. Lookups can still
be slow at busy times; users see why instead of empty results.

## Alternatives considered

Self-hosted instances: robust, but a heavy setup for every user. Commercial
APIs: keys and costs. Silent fallbacks: tried, and they produced empty stop
lists that looked like facts.
