# Observability Specification

## Purpose

Know what each planning session did, cost and produced, and compare models and
settings on evidence.

## Requirements

### Requirement: Runs

Every session SHALL have a run row updated after each turn: model, effort, turns, model calls, tool calls, tokens (input, cache writes, cache reads, output), wall time, estimated cost from list prices, the resulting ride's distance, time, open road, 70 km/h share, slow zones, motorway km, linked roadbook, and error. Unsaved and failed runs SHALL be kept.

#### Scenario: A failed turn

- **WHEN** a planning turn fails and nothing is saved
- **THEN** the run row is kept with its model, effort, tokens, estimated cost, the last routed trip's figures if any, and the error, with no linked roadbook

### Requirement: Trace

Every step SHALL be traced with its scope (planner or scout), kind, name, duration and payload: rider messages, model responses with tokens and tools called, tool calls with input and output, final answers, errors. `rides trace <run>` SHALL replay it as a timeline with a summary per tool; `--full` SHALL show payloads.

#### Scenario: Replay a run

- **WHEN** the rider runs `rides trace 12`
- **THEN** each step is shown with its time, scope and kind (rider message, model call with tokens and tools called, tool call with its result summarised, answer, error), followed by the usage and, per tool, its calls, total time and failures
- **AND** `--full` also prints each step's payload

### Requirement: OpenTelemetry export

`npm run rides -- otel <run|last>` SHALL export a logged session as OTLP/JSON traces following the GenAI semantic conventions: an `invoke_agent` span for the planner and one per scout under the `scoutAreas` call that ran it, a `chat` span per model call with token usage and finish reason, an `execute_tool` span per tool call with failures as error status. It SHALL post to `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, else `OTEL_EXPORTER_OTLP_ENDPOINT` plus `/v1/traces`, with `OTEL_EXPORTER_OTLP_HEADERS`, and otherwise write a file. Prompts, answers, tool arguments and results SHALL be exported only with `--content`.

#### Scenario: No content by default

- **WHEN** a session planned from Lille is exported without `--content`
- **THEN** the traces contain no place name, route id, prompt or answer text

### Requirement: Usage in session

`/usage` SHALL show the session's consumption so far; the settings line SHALL show model and effort; an unknown model id SHALL trigger a warning.

#### Scenario: Usage so far

- **WHEN** the rider types `/usage` after two turns
- **THEN** the prompt prints the model and effort, 2 turns with their model and tool calls, tokens in, from cache and out, the time spent and the estimated cost

### Requirement: Benchmarking

`rides runs` SHALL list all runs in a table (and CSV) fit for comparing models and effort levels; the README SHALL record the benchmark results and the recommended settings.

#### Scenario: Runs as CSV

- **WHEN** the rider runs `rides runs --csv`
- **THEN** every run is a row with its model, effort, turns, calls, tokens, seconds, cost, distance, riding time, road shares, linked roadbook and status
