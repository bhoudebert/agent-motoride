# Tasks

## 1. Versioned migrations (ADR 0022), behaviour unchanged

- [x] `src/migrations.ts`: `user_version`, step 1 = today's schema, legacy libraries stamped
- [x] Transaction per step, foreign key check, backup with `VACUUM INTO`, refuse newer libraries, busy timeout
- [x] Tests: fresh library, version-0 library, applied twice, failure midway leaves the file unchanged, newer refused
- [x] Spec: requirement "Library storage" in `saved-rides`

## 2. Roadbooks and rides tables, behaviour unchanged

- [x] Step 2: `roadbooks`, `roadbook_versions`, `rides` (the day); legs, notes, road ratings and runs re-pointed
- [x] Data moved as ADR 0023 says; ids kept
- [x] Store over the new tables behind the same API; every existing command still answers the same
- [x] Tests: a library with dated and undated rides, chains of copies, notes and ratings migrated as described

## 3. Commands and words

- [ ] Edit in place with versions; undo to a version; copy as a variant
- [ ] Ride on a date: create, refresh, briefing, cancel; stale after an edit
- [ ] Ratings split (roadbook, ride); review stores road ratings on the roadbook
- [ ] Overlap offers a ride of the existing roadbook
- [ ] CLI, MCP tools and prompts, exports, ride map, memory adapted; reference regenerated
- [ ] Guide, README, engineering notes, site, roadmap
