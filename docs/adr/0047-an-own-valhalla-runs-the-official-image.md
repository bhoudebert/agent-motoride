# 0047. An own Valhalla runs the official image

- Status: accepted (refines 0043)
- Date: 2026-10-31

## Context

ADR 0043 put an optional `valhalla` service in the compose files with the community image `gis-ops/docker-valhalla`, "written
from the image's documentation and not yet run here"; no reason for that choice over the project's own image was recorded. Running
it showed two things: its rebuild flag rebuilds from the extracts on disk and downloads nothing (the map stayed as old as the first start,
fixed by `deploy/update-map.sh`), and the repository is now archived, so the image no longer follows Valhalla. Valhalla publishes its own
image, `ghcr.io/valhalla/valhalla-scripted`, with the same settings (`tile_urls`, `force_rebuild`, `use_tiles_ignore_pbf`,
`build_admins`, `build_time_zones`, `server_threads`), the same `/custom_files` folder and the same port 8002.

## Decision

The compose files use `ghcr.io/valhalla/valhalla-scripted:latest`. `deploy/update-map.sh` pulls the image before it rebuilds, so a
refresh also brings a newer Valhalla. A host moving over rebuilds once (the old tiles were built by another version). Pinning a version
tag instead of `latest` is left until one has been run here.

## Consequences

The routing engine follows Valhalla itself. Not verified yet: that the official image behaves as its documentation says here (file
ownership of the volume, the build time), and that `/custom_files` of the old image is read by the new one; the script's rebuild does not depend
on it, since it deletes the extracts and the host rebuilds anyway.

## Alternatives considered

Staying on the archived image: it works today, but only as long as Valhalla's tile format does not move on. Building Valhalla from source in
our own image: more to maintain for no gain.
