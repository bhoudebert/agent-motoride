# Roadmap and ideas

Not commitments. Ordered by expected value for a rider who plans here and rides
with a navigation app (Liberty Rider, Google Maps) on the phone.

## Learn from what was actually ridden

- **Recorded tracks**: notes during the ride and a review against the
  recorded GPX (placement on the road ridden, detours, pace, road ratings) are
  done, see README "Rating what you rode". Next: mark legs ridden as planned,
  skipped or diverted, and real stop times.
- **Calibrate the time estimate from recordings**: fit the bend factor and the
  town cap to the rider's own pace instead of guesses. Report "your estimate
  runs 6% slow on 70-roads".
- **Ride diary**: a Markdown summary per recorded ride, next to the plan.

## Make the agent smarter over time (memory)

- **Area profiles**: after a scout or a plan, store what was learnt about an
  area (median curviness, open-road ceiling, typical 50-zone share, best roads).
  The planner reads profiles first and scouts only unknown areas: cheaper every
  time.
- **Road memory**: per road ref, everything known from rides, ratings and
  recordings. "What do I know about the D 936?" answered from data.

## Rider safety and comfort, from data already at hand

- **Rain in the next two hours** (nowcast) in the ride-day briefing.
- **Temperature at altitude** on passes, from elevation.

## Fuel

- **French fuel prices** (open data, free): choose the cheapest station among
  the candidates, show the price per stop.

## Reach

- **GitHub Copilot as MCP client** (VS Code agent mode): a `.vscode/mcp.json`
  entry; prompts appear as slash commands there. Codex is supported already.

- **Telegram bot**: plan, brief and fetch exports from the phone, away from the
  computer. Largely superseded by Claude Code Remote Control (see README), which
  gives a remote prompt with no bot and no API cost; kept for a path that does
  not depend on a Claude plan.
- **Files to the phone when away from home**: Remote Control shows text; GPX
  and Markdown stay on the machine. Paused: it needs a truly private
  destination (the rider's own storage); public or unlisted links such as
  gists are not acceptable for ride files and home addresses. The same gap
  applies the other way: a track recorded on the phone has to reach the
  machine for a review.
- **Weekly auto-plan**: Friday evening, best weekend day, sent to the phone.

## Agent quality

- **Constraint checker loop**: code verifies the itinerary against the request
  and sends violations back; the agent retries by itself.
- **Scouts per request** in MCP mode ("use scouts") without editing `.env`.
- **Evaluation harness**: done (cases, code graders, record and replay, injection
  case; README "Evaluating the agent"). Next: an LLM judge with a rubric for
  what code cannot grade, checked against the rider's own ratings; a runner
  through Claude Code headless (`claude -p` with the MCP server) so live evals
  run on the subscription; more cases (edits, follow-ups, Codex).

- **OpenTelemetry**: export of logged sessions done (`rides otel`). Next: live
  spans during a session, and the MCP server's tool calls as their own service.

## Smaller items

- Rain-free window finder over the next 16 days for a saved ride.
- Points of interest and elevation per leg.
- Background cameras and stops after the itinerary.
- Named bike profiles; database backup command; calendar (ICS) file.
- Multi-day trips with overnight stops; group rides with a meeting point.
