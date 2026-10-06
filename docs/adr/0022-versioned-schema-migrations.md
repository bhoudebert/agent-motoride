# 0022. Versioned schema migrations, applied in a transaction after a backup

- Status: accepted
- Date: 2026-10-06
- Amends: [0003](0003-sqlite-single-file.md) (how the schema changes)

## Context

The library is one SQLite file (ADR 0003). Its schema is applied on every
start with `CREATE TABLE IF NOT EXISTS` and a loop that adds three missing
columns to `rides`. That handles additions only. The next change (ADR 0023)
splits `rides` into roadbooks and rides: data moves between tables, foreign
keys change, and a failure halfway would damage the rider's only copy of
their library. The CLI and the MCP server can also open the file at the same
time.

## Decision

- The schema has a version, stored in the file with `PRAGMA user_version`.
- Migrations are numbered steps in `src/migrations.ts`, applied once each, in
  order, on open. Version 1 is today's schema, including the columns added
  so far; a library at version 0 with a `rides` table is brought to version 1
  by the existing additive steps, then stamped. A new library runs every step.
- Each step runs inside `BEGIN IMMEDIATE ... COMMIT`, with the version bump in
  the same transaction: it applies completely or not at all. Steps that
  rebuild a table turn foreign keys off for the step and run
  `PRAGMA foreign_key_check` before committing; any violation rolls back.
- Before the first pending step, a file library is copied with
  `VACUUM INTO '<file>.bak-v<from>'`, a consistent copy even in WAL mode.
- A library newer than the code (version above the last step) is refused with
  a clear message, never opened.
- `PRAGMA busy_timeout` lets a second process wait for a migration in
  progress instead of failing; it then finds the file at the new version.
- Derived tables (road memory, lookup cache) may be dropped by a step and are
  rebuilt on their own.

## Consequences

Structural changes become safe to ship: each is tested on a library built at
the previous version, run twice to prove it is applied once, and made to fail
midway to prove nothing changes. The cost is a little ceremony for each
change, and backups that accumulate next to the library (one per migrated
version), which the rider can delete.

## Alternatives considered

An ORM or migration tool (Drizzle, Knex, Prisma): a dependency and a build
step for one SQLite file. Rebuilding the library from an export on each
change: loses data the export does not carry. Keeping additive changes only:
cannot express ADR 0023.
