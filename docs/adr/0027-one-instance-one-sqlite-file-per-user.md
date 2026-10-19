# 0027. One instance, one SQLite file per user

- Status: accepted (amends ADR 0003)
- Date: 2026-10-19

## Context

agentRide was made for one rider (ADR 0003). The owner wants to offer it to others as a server, reached from Claude Code or
Codex through the MCP tools, with no model and no API key of ours (the client's model plans; ADR 0021 already hands the
scouting to the client), and wants updates to stay painless. A container per rider works but multiplies what has to be
run as riders come. Postgres with a schema per rider would need the whole store, synchronous SQLite today, rewritten as
asynchronous code.

## Decision

One agentRide process serves all riders. Each rider is a **tenant** with a library of its own, one SQLite file under
`data/tenants/<id>/`. A small registry (`data/registry.db`) holds the tenants: a random UUID (not a counter, and not a hash of
the email, which can be guessed and checked; it is a folder name and never what grants access, the token is), the email, a status, and the hash of a random 256-bit token that is shown once.
The MCP tools are reached over HTTP with the token as a bearer; the token chooses the library. An administrator
command adds, lists, removes, suspends, re-keys and backs up tenants. Used alone, with no registry and no setting,
agentRide is exactly what it was: one library in `data/agentmotoride.db`; `RIDE_TENANT=<id>` chooses a tenant's
library from the terminal. Updates ride on the versioned migrations of ADR 0022: a tenant's library is migrated, after
a backup, the first time it is opened after the update.

## Consequences

One thing to run, update and back up, however many riders. The public services (Overpass, Valhalla) see one polite
client and one queue (ADR 0007) instead of one per rider, and a cache could be shared. Isolation is by file and by token,
not by process: the code that serves a request must never hold one rider's state where another can reach it, and the MCP
server's session state has to move from module variables into a context made for each request (a later change).
SQLite is the limit: one writer per library is fine for one rider each, and the files can be spread over disks. If
riders ever number in the thousands and busy, the store is the place to look, not before.

## Alternatives considered

A container and a database per rider: simple isolation, more to run and update with every rider. Postgres with a
schema per rider: the right tool for thousands of busy users, and a rewrite of the store for a handful. An email hash as
the tenant name: reversible by trying likely addresses.
