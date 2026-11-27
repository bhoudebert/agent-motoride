# 0062. Tools declare an output schema and return structured results

- Status: accepted
- Date: 2026-11-27

## Context

MCP clients are starting to expose a server's tools as a typed code API
("code mode"): the model writes a short script that calls the tools, instead of
loading every tool definition and passing every intermediate result through its
context. That saves tokens (definitions loaded on demand, large results such as
route geometry or hourly weather filtered in code), saves round trips (the
finishing steps of a ride can run in one script) and allows loops and
conditions in code.

All our tools returned a JSON string in a text block. A typed binding cannot
read a string: the generated function returns `unknown` and the model has to
parse and probe it blind. Only the inputs were typed (zod, with descriptions).

## Decision

- Every tool declares an `outputSchema` (zod, root an object) and returns
  `structuredContent` that matches it. The MCP SDK validates the result against
  the schema, so a wrong shape fails in our own tests and never reaches the
  client.
- The text block stays: the object as JSON for data tools, the sentence or
  document for prose tools. Clients that do not read `structuredContent` and
  today's prompts, specs and wording are unchanged.
- Shared tools (`src/tools/`) carry their schema in their definition, next to
  the input schema, in `src/tools/outputSchemas.ts`; the tools registered by
  the server carry theirs in `src/rideOutputSchemas.ts`. The API runner ignores
  the output schema, as it ignores the MCP hints.
- The repeat guard no longer wraps the earlier result: it adds `repeatedCall`
  and `repeatNote` beside the original fields, so the schema still holds and a
  tool's own `note` is kept.
- Failures stay errors. Rider rules and the rider's confirmation of a deletion
  stay in code and in the tool instructions: a script calls the same handlers,
  so nothing is bypassed by typing the results.

## Consequences

Roughly 45 schemas to keep in step with the code: a test runs every tool
offline and validates its real result, so a drift fails the quality gate. A
change to a result's fields is now a change to a schema and to its spec.
Fields are described once, in the schema, and clients show them to the model.
A script can call a destructive tool without a turn between: the tool's own
confirmation (dialog, or a second call with `confirm`) stays the guard.
