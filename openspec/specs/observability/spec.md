# Observability Specification

## Purpose

Know what each planning session did, cost and produced, and compare models and
settings on evidence.

## Requirements

### Requirement: Runs

Every session SHALL have a run row updated after each turn: model, effort, turns, model calls, tool calls, tokens (input, cache writes, cache reads, output), wall time, estimated cost from list prices, the resulting ride's distance, time, open road, 70 km/h share, slow zones, motorway km, linked saved ride, and error. Unsaved and failed runs SHALL be kept.

### Requirement: Trace

Every step SHALL be traced with its scope (planner or scout), kind, name, duration and payload: rider messages, model responses with tokens and tools called, tool calls with input and output, final answers, errors. `rides trace <run>` SHALL replay it as a timeline with a summary per tool; `--full` SHALL show payloads.

### Requirement: Usage in session

`/usage` SHALL show the session's consumption so far; the settings line SHALL show model and effort; an unknown model id SHALL trigger a warning.

### Requirement: Benchmarking

`rides runs` SHALL list all runs in a table (and CSV) fit for comparing models and effort levels; the README SHALL record the benchmark results and the recommended settings.
