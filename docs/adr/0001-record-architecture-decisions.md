# 0001. Record architecture decisions

- Status: accepted
- Date: 2026-10-05

## Context

The project grew fast through many small choices: tools over prompts, two
execution modes, a custom time model, public data services. The reasons live
in pull requests and conversations, which are hard to find later.

## Decision

Significant choices are recorded as short decision records in `docs/adr/`,
numbered, using `template.md`. A record is never rewritten after acceptance; a
later record supersedes it. Behaviour itself is specified in `openspec/specs/`;
records explain why the system is shaped the way it is.

## Consequences

Newcomers and agents can read why before changing what. Writing a record costs
a few minutes per significant change.

## Alternatives considered

Relying on commit messages and pull request descriptions: too scattered.
Putting rationale into the specs: mixes "what" with "why" and bloats them.
