# 0064. One own Overpass for the whole area, refreshed like Valhalla

- Status: accepted
- Date: 2026-11-27

## Context

ADR 0063 had the compose files run one Overpass instance per region (Belgium, the north of France), each following its region's daily changes,
because the image imports one extract and follows one feed. The host wanted what Valhalla already is: one local instance for the whole area,
the public servers as the fallback while it is refreshed. Valhalla is refreshed on a schedule (`deploy/update-map.sh`, about monthly), and
that is acceptable for cameras and stops, which are cached for 30 days anyway (spec external-lookups, caching).

## Decision

- One `overpass` service (profile `overpass`). Its preprocess step downloads the extra extracts, merges all extracts with `osmium` and
  converts them to the format the image imports. The extracts are settings: `OVERPASS_EXTRACT` and `OVERPASS_EXTRA_EXTRACTS`, Belgium and the
  north of France by default. It follows no feed and keeps serving after the import.
- `deploy/update-overpass.sh` empties the database and imports again, to be run about monthly from cron. While it imports, the public
  servers answer: that is what makes one instance enough, with no second instance and no downtime to manage.
- The code is unchanged: `OVERPASS_URL` still takes several addresses, merged by id, for a host that runs one instance per region.

## Consequences

Simpler to run and to explain, at the price of a map as old as the last refresh (like Valhalla). Outside the imported areas the instance
answers empty, without saying so: the host imports the regions it rides in (said in the guide). The merge line, the tools it needs in the image
and the behaviour of `OVERPASS_STOP_AFTER_INIT` were not run on a real server when this was written; the guide says so, and the public fallback
limits the harm.
