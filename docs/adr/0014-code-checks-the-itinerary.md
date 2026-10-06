# 0014. Code checks the itinerary; the planner gets one chance to fix it

- Status: accepted
- Date: 2026-10-06

## Context

The rider's distance and time caps are hard limits, and the prompt says so,
but nothing verified the final answer against them: a loop over the cap, a
repeat of a saved ride or a distance in the text that differs from the routed
one reached the rider unchecked. The evals (ADR 0013) grade these after the
fact; the rider needs them checked before the answer is shown.

## Decision

After every itinerary, code checks it: the routed distance and riding time
against the caps read from the rider's words by a deterministic parser
("under 250 km", "at most two hours"), motorways when forbidden, repeats of
saved rides, share on roads rated 0-1, and the distance stated in the answer
against the routed one. In API mode a failed check sends the planner one
message marked as an automatic check, listing what failed; it fixes the
itinerary or says plainly which limit cannot be met. An answer that already
acknowledges the breach is not sent back. What still fails after the retry is
shown to the rider under the itinerary. In MCP mode the same checks are the
`checkItinerary` tool, which the server instructions ask the client to call
before presenting an itinerary.

## Consequences

A violation costs one more model turn; a clean itinerary costs nothing, so
recorded evals of good answers replay unchanged. Caps the parser does not
recognise are not checked; the parser is tested and extended with cases.
Acknowledgement is detected by wording, which can let a breach through when
the answer mentions it loosely.

## Alternatives considered

A model as the checker: costs a call on every answer and is not
deterministic. Caps as a field of the structured answer: the model would
grade itself, and old recordings would no longer parse. Retrying until the
check passes: an impossible request would loop.
