# 0015. Export sessions as OTLP/JSON, written without the OpenTelemetry SDK

- Status: accepted
- Date: 2026-10-06

## Context

Every session is already logged in SQLite (runs and trace tables) and can be
replayed with `rides trace`. Observability tools (Langfuse, Phoenix, Jaeger,
Grafana Tempo, Datadog) read OpenTelemetry, and the GenAI semantic
conventions now name agent, model and tool spans and their token attributes.

## Decision

`npm run rides -- otel <run>` converts a logged session into OTLP/JSON with
the GenAI conventions: `invoke_agent` for the planner and for each scout
(nested under the `scoutAreas` call that ran it), `chat <model>` with token
usage and finish reason, `execute_tool <name>` with errors as span status.
It posts to the standard `OTEL_EXPORTER_OTLP_ENDPOINT` with
`OTEL_EXPORTER_OTLP_HEADERS`, or writes a file. The JSON is written by hand
(about 200 lines), not with the SDK. Prompts, answers, tool arguments and
results are exported only with `--content`.

## Consequences

No new dependency, and any past session can be exported, since the source is
the stored trace rather than live instrumentation. Spans are reconstructed:
a model call is taken to start when its agent's previous step ended. Live
streaming of spans during a session is not provided. Without `--content`,
the export carries no place, route or prompt.

## Alternatives considered

The OpenTelemetry SDK with live instrumentation: a dozen packages and code in
the planner loop, and nothing for the sessions already logged. A vendor SDK
(Langfuse): one backend only.
