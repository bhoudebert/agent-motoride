# 0020. Road memory: what the app learnt, retrieved by place and by words

- Status: accepted
- Date: 2026-10-06

## Context

Every planning session leaves knowledge behind: saved rides and their
ratings, notes and rated road stretches, and in the trace, the scouts'
verdicts per area (found or not, open-road share, why) and the winding roads
found by road searches, with coordinates usable as waypoints. New sessions
started from nothing: areas already found poor were scouted again, and roads
already found were searched again, at the cost of model calls and minutes.

## Decision

A memory table derived from what is stored, never typed in: rides and legs,
rated road stretches, scout verdicts per area, and known winding roads per
road search. It is kept current incrementally (rides and ratings rebuilt,
traces read from a watermark), so it costs nothing to maintain and can be
rebuilt at any time.

Retrieval is by place first (items within a radius of a point, from their
coordinates or grid cells) and by words second (SQLite FTS5, BM25 ranking,
diacritics folded). The `recallArea` tool returns, for a place, the rides with
their ratings, loved and avoided stretches, past scout verdicts with their age,
and known winding roads; the planner and the scouts are told to consult it
before scouting or searching roads. Weather is never part of the memory.

No vector embeddings for now: the corpus is small and mostly structured
(places, road refs, ratings); geography and keywords cover it, and embeddings
would need a model download or a paid API for little gain. The retrieval sits
behind one function, so a semantic layer can be added if the evals show
misses.

## Consequences

Repeat visits to a region can skip scouts and road searches. The memory holds
what earlier models wrote in their reports; verdicts carry their date so the
planner can judge staleness. Measuring the gain needs live recordings
(billed), done separately.

## Alternatives considered

Embeddings with a local model (transformers.js): a large download and native
code. A hosted embedding API: a key and a bill. Feeding the whole library into
the prompt: does not scale, and costs tokens on every call.
