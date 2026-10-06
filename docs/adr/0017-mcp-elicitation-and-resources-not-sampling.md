# 0017. MCP: ask the rider through elicitation, offer rides as resources; no sampling

- Status: accepted
- Date: 2026-10-06

## Context

Beyond tools and prompts, MCP lets a server ask the client's model to
generate text (sampling), ask the user for structured input during a tool
call (elicitation), and publish read-only documents the user attaches
(resources). Scouts are the only part of the MCP mode that needs an API key;
sampling would have run them on the client's model. Two decisions belong to
the rider and today go through a chat round-trip: the ratings of a ride
review, and saving a ride that duplicates a saved one.

Checked in October 2026: Claude Code does not support sampling (open feature
request), and the 2026-07-28 MCP specification deprecates it. Claude Code
supports form elicitation (2.1.76 and later). It lists resources in its `@`
completion; one report says it does not read them. Codex support for
elicitation and resources could not be confirmed.

## Decision

- No sampling. Scouts keep using the API key when present, and the client's
  model explores by itself otherwise (`RIDE_SCOUTS=0` or no key).
- Elicitation for decisions that are the rider's: `reviewRide` asks for one
  rating per placed note (proposal filled in, or dismiss) in a form, and
  `saveRide` asks "save a copy anyway?" when a ride duplicates a saved one.
  Used only when the client advertises elicitation; otherwise the chat flow
  of before stays, unchanged.
- Resources: `ride://library`, `ride://ride/{id}` and `ride://roads/rated`, as
  text, for clients that attach them. Kept only if Claude Code reads them in
  practice; removed otherwise.

## Consequences

In Claude Code a review is confirmed in one dialog instead of a second tool
call written by the model, and the model cannot rate on the rider's behalf.
The fallback path stays tested and in use for other clients. Resources cost
little and may be useless in a given client; that is checked by hand.

## Alternatives considered

Sampling for scouts: unsupported and deprecated. Asking the model to confirm
with the rider in chat (the current flow): kept as the fallback.
