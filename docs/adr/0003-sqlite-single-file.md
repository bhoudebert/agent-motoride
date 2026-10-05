# 0003. One SQLite file for rides, runs, traces and cache

- Status: accepted
- Date: 2026-10-05

## Context

The app needs to keep saved rides with versions and ratings, a log of every
planning session, step-by-step traces, a lookup cache and a bike profile. It
runs on a laptop, a small home server or a VPS, for one rider.

## Decision

Everything lives in one SQLite file (`data/agentmotoride.db`) through Node's
built-in `node:sqlite`. JSON columns hold nested data (legs extras, usage).
Schema changes are applied on startup with additive `ALTER TABLE`s; a renamed
file is migrated once.

## Consequences

No server to run, no dependency, backups are a file copy, and the MCP server and
the CLI share the same library. The trade-off is one writer at a time and no
multi-user story, which this project does not need.

## Alternatives considered

PostgreSQL: right for many users, overkill here. Plain JSON files: no queries,
no transactions, fragile under concurrent writes from CLI and MCP server.
