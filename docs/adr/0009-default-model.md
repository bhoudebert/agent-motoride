# 0009. Sonnet as the default planner model

- Status: accepted
- Date: 2026-10-05

## Context

A benchmark on one request planned five times (Opus high, Sonnet high, Sonnet
medium twice, Haiku): Opus cost $0.40 for a ride of the same quality as Sonnet
high at $0.17; Sonnet medium cost $0.08 to $0.11 with uneven quality; Haiku
cost more than Sonnet medium through extra calls and broke the time limit.

## Decision

Recommend `claude-sonnet-5-5`: medium effort for everyday use and edits, high
effort when the ride must be right first time. Opus and Haiku remain
selectable through `RIDE_MODEL`. Scouts run on Sonnet at low effort.

## Consequences

Plans cost a fraction of the Opus price with comparable rides. The evidence is
small (five runs, one region); the runs table and trace support repeating the
benchmark.

## Alternatives considered

Opus by default: no measurable gain for the price. Haiku: false economy.
