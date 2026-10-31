# 0052. A pushed roadbook is added to the library

- Status: accepted
- Date: 2026-10-31

## Context

A rider who plans on a library kept elsewhere pushes a roadbook file to their server. The first design kept each pushed file as a file in a
`pushed` folder of the rider, with its own index, its own ids from 1,000,000 up and its own serving code, apart from the library database. A
pushed roadbook was then not in the rider's library: invisible to a query of it, to the MCP tools (`listRoadbooks`, `refreshRide`,
`deleteRoadbook`), to the refresh states of ADR 0050 and to a removal, and the phone had two kinds of roadbooks to tell apart.

## Decision

A pushed file is turned into a roadbook of the rider's library (`saveRide`, or `reviseRoadbook` for a roadbook sent before), from the
line, the waypoints and the cameras of the file. Its speed limits, countries and roundabouts are not taken from the file: they are
traced on the server's own map when the file is made for the phone, like those of a roadbook planned there. A file that says which roadbook
it is replaces the earlier push and keeps the earlier version; an unchanged file changes nothing. The `pushed` folder and its code are
removed, and files an earlier server kept there are brought in once.

## Consequences

A pushed roadbook behaves as the rider's own on the server and the phone: one list, one number, one refresh, one deletion, the same
`restoreRoadbook`. The server's map decides its limits, not the planner's; planned stops are recomputed by a refresh from the bike profile
and not carried. A pushed roadbook is a lossy copy of the one planned elsewhere: legs are cut at the waypoints by position, and the exact
limits traced there are traced again here.

## Alternatives considered

Keeping the folder and showing it as part of the library in each tool: every tool would need to know two stores. Storing the whole file as
a blob on the roadbook: the library tools and a refresh would still not see its legs.
