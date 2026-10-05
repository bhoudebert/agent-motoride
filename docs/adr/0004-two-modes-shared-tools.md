# 0004. Two execution modes over one tool definition: API and MCP

- Status: accepted
- Date: 2026-10-05

## Context

Running the planner through the Anthropic API costs money per request. Many
users already pay for a client with its own model (Claude Code, Codex). The
tools themselves do not depend on who runs the loop.

## Decision

Tool definitions (name, description, schema, implementation) are declared once
in `src/tools/index.ts`. The API mode wraps them for the SDK tool runner with
our own system prompt and a schema-validated final answer. The MCP mode exposes
the same definitions as a Model Context Protocol server, plus prompts (slash
commands), server instructions, and a `planningGuide` tool for clients without
prompt support.

## Consequences

One implementation, two ways to pay, and any MCP client works (Claude Code,
Codex, and remote use from a phone through Claude Code). The MCP mode gives up
control: the client's model, effort and context handling apply, and its
answers are not schema-validated, so saving takes an explicit route id.

## Alternatives considered

API only: simplest, but costly for daily use. A bespoke client per model
vendor: duplicated logic.
