# 0049. Two Valhalla servers are rebuilt in turn

- Status: accepted (refines 0043, 0048)
- Date: 2026-10-31

## Context

An own Valhalla is down for the two hours of a rebuild (ADR 0047), and agentRide can use several servers and picks the one with the
newest map (ADR 0048). The host chose to run two instances on a 22 GB server with 113 GB of free disk.

## Decision

The compose files carry a second service `valhalla2`, behind its own profile (`valhalla2`) and with its own volume, so a host that does not ask
for it has one instance as before. `deploy/update-map.sh` finds the instances that have been created, asks each one's `/status` for the
date its map was built, and rebuilds only the older one (the first when equal; one that does not answer counts as the oldest) with
`--no-deps`, leaving the other untouched and answering. It then clears the rebuild flag as before. With one instance it says routing is down
while it builds. No state is kept: which is older is read from the servers each time.

## Consequences

No downtime for the map, and the newest map is at most one interval old. Disk and memory are doubled, and the second instance's first build
is a full one. The two instances share the image and the rebuild flag variable, but a run only recreates the target, so the other keeps its
container as it was.

## Alternatives considered

Editing a URL order in the compose file or `.env` after each run: a tracked file to edit and a restart of the server, for nothing the
ranking by date does not already give. Building the new map in a second volume of one instance and swapping: the same disk, more script,
and a moment of downtime at the swap.
