# 0063. Own Overpass instances, one per region, with the public ones as fallback

- Status: accepted
- Date: 2026-11-27

## Context

The cameras, stops and road search come from the public Overpass servers. On 27 November they were at capacity (502) or closed to us (403),
and two planning sessions stalled for minutes on `getSpeedCameras` and `planStops` (a lookup along a route now ends within 75 seconds,
spec external-lookups). Valhalla can already be run by the host (ADR 0043), but it does not serve these lookups.

Overpass differs from Valhalla in what matters for running it. The community image imports one extract and follows one update feed, so
several countries are several instances, not one. It applies the region's changes while it runs, so it needs no rebuild, no second instance
and no downtime for updates (ADR 0048 solved that for Valhalla). Regional extracts are small (Belgium 668 MB, Nord-Pas-de-Calais 231 MB).

## Decision

- `OVERPASS_URL` lists the host's own instances, comma-separated like `VALHALLA_URL`. Several are regions of one map, not copies: a query
  goes to all of them and the elements are merged by id.
- The public instances stay as the fallback: when any listed instance does not answer, the query goes to them whole, never to the half of a
  region, so a missing answer cannot look like "nothing there". A failed instance rests for a minute.
- The compose files offer `overpass-be` and `overpass-nord` on request (profile `overpass`), reached by the ride service only.

## Consequences

An outage of the public servers no longer stops cameras and stops for the regions the host imported, and updates cost nothing. A ride into
a country that was not imported gets empty results from the own instances and is not told so: the host must import the regions it rides in
(said in the guide). The image, its conversion step and the update feeds were not run on a real server when this was written: the guide
says so, and the public fallback limits the harm. Another service to keep alive, small in disk and quiet in memory as far as we know.
