# 0051. A rider's settings are kept in their library

- Status: accepted
- Date: 2026-10-31

## Context

The bike profile has always been kept in the rider's library (a `profile` table), but the rest of what a rider sets with `rideSettings`
was not: the start point and the road preferences (motorways, the 30 and 50 zone targets, long straights, fast expressways) lived in the
session, started from the process environment. On a server that environment is the host's, shared by every rider, and nothing a rider chose
lasted past the session; `RIDE_HOME` could not be a rider's own.

## Decision

Library version 4 adds a `settings` table (key, JSON value) with those keys. A session starts from the rider's saved settings over the
host's environment over the defaults: `effectivePreferences(saved)`. `rideSettings` saves what the rider gives, and `reset` forgets it. The
start point is saved as the rider typed it and resolved at the start of the next session; one that cannot be found leaves the start point
unset and does not fail the session. The terminal and the stdio MCP read the same table, so a person using several clients keeps one set of
settings; a flag or "for this ride" still wins for one plan. The environment stays the default for whoever has saved nothing.

## Consequences

Each rider on a server has their own start point and targets with nothing to repeat, and the host's `.env` is only a starting point. Changing
the host's environment later does not change what a rider has saved: `reset` does. A phone endpoint to read and write the same settings is
possible and not built. `allowRepeat` stays per session on purpose.

## Alternatives considered

Environment overrides stored values: a rider's choice would be ignored on a host that sets the variable, and an environment cannot differ
per rider. Keeping them in the existing `profile` table: its reader spreads every key into the bike profile. A settings file per rider next to
the library: another thing to back up and migrate.
