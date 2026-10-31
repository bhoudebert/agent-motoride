# 0048. Several Valhalla servers: the newest answers

- Status: accepted (refines 0043)
- Date: 2026-10-31

## Context

An own Valhalla (ADR 0043) is down for about two hours each time its map is rebuilt, and the server has no other source: roadbook
files and routes fail meanwhile. Its map is also as old as its last rebuild (ADR 0047). A host with room can run two instances and rebuild
them in turn, if agentRide can use both. Every Valhalla reports when its tiles were built at `/status` (`tileset_last_modified`); the
public server's, read on 2026-10-31, was built that morning.

## Decision

`VALHALLA_URL` may list several servers, separated by commas. agentRide asks each one's `/status`, keeps the ranking five minutes, and
sends a request to the one with the newest map; a server that does not answer or does not give a date comes after those that do, in the order
given. When the chosen server cannot answer (no answer, 5xx, 429) the next is tried and the ranking is forgotten; a request that a server
refuses as wrong (other 4xx) is not tried again elsewhere. One address behaves as before and never asks `/status`.

## Consequences

A rebuilding instance costs nothing: it does not answer `/status`, so the other serves; when it is done and newer, it takes over. No state
is kept and no order is edited. The public server is not listed by default: it would usually win by date. Ranking costs one cheap request per
server every five minutes. Both instances use disk and memory: that is the host's choice, and the setup is described in the guide.

## Alternatives considered

Rotating the order in a file or the compose file by script: state to keep and a tracked file to edit. A fixed order with failover only: the
older server would answer while the fresher one is ready.
