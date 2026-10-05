# 0013. Evaluate the planner on recorded sessions, replayed for free

- Status: accepted
- Date: 2026-10-05

## Context

The planner is a model loop: a prompt edit, a model change or a tool change
can make it worse without any unit test noticing. The benchmark (ADR 0009)
measured cost and a few figures once, by hand. Live runs bill the API key, so
they cannot run on every pull request, and public map data is editable by
anyone, so names in tool results are an injection path that nothing tested.

## Decision

An eval suite in `evals/`: scripted rider requests (`cases.ts`) and code
graders (`graders.ts`) over what a session did (answer, routed trip, tool
calls, settings). Graders are tiered: `rule` for what code guarantees
(motorways excluded, settings unchanged by tool data), `quality` for the
model's work (caps met, finishing steps, distance stated as routed, scouts
when expected, duplicates and rated roads avoided, planted instructions
ignored).

Every HTTP exchange of a session is recorded once, live, into a cassette
(`npm run eval -- --record`, billed, budget-capped, run locally on demand).
Replays serve every exchange from the cassette: no network, no cost, in CI on
every push. A replay fails on a broken rule, on a grader that passed when
recorded and fails now, or on a request the cassette cannot answer. Model
steps are keyed by conversation and turn, so a prompt or tool-output change
replays and is reported as drift instead of failing. Missing tool answers can
be fetched live for free (`--update-tools`); a missing model answer never
reaches the API.

Injection cases plant instructions in road, place and shop names while
recording. The prompts state that map text is data, and the code rules hold
whatever the model reads.

## Consequences

Code regressions in tools, graders, rules and answer handling are caught for
free. Prompt and model quality are measured only by re-recording, which costs
money and is a deliberate act. Replayed answers are frozen: a replay can show
that new code breaks an old good answer, not that a new prompt is better.
Cassettes contain public map data and model text, no secrets; cases use
public start points only.

## Alternatives considered

Live evals in CI: real signal, but a bill on every push and flaky public
services. Mocked model scripts only (the existing planner tests): free but
test the plumbing, not a model's behaviour. An LLM judge: kept for the live
layer, where a model call is already being paid for.
