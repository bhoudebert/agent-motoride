# 0002. An agent decides, deterministic tools supply every fact, code enforces the rules

- Status: accepted
- Date: 2026-10-05

## Context

A language model can plan a plausible ride from memory, but distances, speed
limits, forecasts and opening hours from memory are unreliable, and a rider's
hard limits (no motorways, under 3 hours, dry) must hold every time.

## Decision

The model chooses where to look and what to propose. Every figure comes from a
tool backed by data (OpenStreetMap, Valhalla, Open-Meteo, TomTom). Rules that
must never break are enforced in the tools or the store, not in the prompt:
motorway exclusion in routing, route ids validated on save, duplicate rides
refused, closed stops avoided. The prompt states the method; the code holds
the line.

## Consequences

Answers are traceable to tool results and reproducible from the trace. Model
mistakes show up as poor choices, not as false facts or broken rules. The cost
is a larger tool surface to build and test.

## Alternatives considered

Prompt-only planning with web search: cheaper to build, unverifiable output.
A fixed pipeline without an agent: predictable, but cannot explore regions or
adapt to unusual requests.
