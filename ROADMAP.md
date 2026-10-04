# Roadmap and ideas

Not commitments. Ordered by expected value for a rider who plans here and rides
with a navigation app (Liberty Rider, Google Maps) on the phone.

## Learn from what was actually ridden

- **Import recorded tracks** (GPX from Liberty Rider or any app). Match the
  recording to the planned ride: where the rider left the planned roads, real
  speed per segment, real stop times. Auto-rate legs that were ridden as planned
  ("done", "skipped", "diverted").
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

- **Crosswind exposure per leg**: wind direction and gusts from the forecast
  against each leg's heading; warn on exposed open stretches.
- **Low sun glare**: sun azimuth at the time of each leg against its heading;
  warn where the rider heads into a low sun.
- **Surface check along the route**: cobblestones (Belgian pavé), sett, gravel
  on the routed line, from OpenStreetMap surface tags. Warn or reroute.
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
  and Markdown stay on the machine. A small upload step (private share link)
  would complete the remote use.
- **Weekly auto-plan**: Friday evening, best weekend day, sent to the phone.

## Agent quality

- **Constraint checker loop**: code verifies the itinerary against the request
  and sends violations back; the agent retries by itself.
- **Scouts per request** in MCP mode ("use scouts") without editing `.env`.
- **Evaluation harness**: fixed request set, scored from the runs table.

## Smaller items

- Rain-free window finder over the next 16 days for a saved ride.
- Rating prompt after a ride date.
- Points of interest and elevation per leg.
- Background cameras and stops after the itinerary.
- Named bike profiles; database backup command; calendar (ICS) file.
- Multi-day trips with overnight stops; group rides with a meeting point.
