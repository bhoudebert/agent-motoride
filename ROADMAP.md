# Roadmap and ideas

Not commitments. Ordered by expected value for a rider who plans here and rides
with a navigation app (Liberty Rider, Google Maps) on the phone.

## Help wanted

Open to anyone, no API key needed for most (see `CONTRIBUTING.md`):

- **Legal speed defaults** for countries and regions missing from
  `RURAL_DEFAULT_KMH` (`src/tools/trip.ts`), with their source.
- **Eval cases** for requests the agent handles badly: a mountain pass closed
  in winter, a ride across a border, a group with two starts.
- **Another traffic source** next to TomTom, behind the same `getTraffic`.

## Areas chosen from data

- **An area finder**: today the planner picks the areas to scout from its own
  knowledge of the region. A tool could propose them from data instead: a grid
  around the start within the reach of the rider's limits, each cell scored on
  the density of winding roads and its built-up share from OpenStreetMap, the
  best cells returned with their central town. The model would arbitrate
  rather than guess, and the choice would be testable and repeatable.

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

- **Constraint checker loop**: done (code checks every itinerary, one retry;
  README "Checked by code before you see it"). Next: check "dry" against the
  forecast along the loop, and the return before sunset.
- **Scouts per request** in MCP mode ("use scouts") without editing `.env`.
- **MCP**: elicitation for review ratings and duplicate saves, and rides as
  resources, done (ADR 0017). Scouts on the client's model (sampling) is not
  possible: unsupported in Claude Code and deprecated in the MCP spec. Instead,
  with API scouts off, Claude Code scouts with its own parallel subagents, done
  (ADR 0021), and their verdicts reach the road memory through `reportScout`.
- **Evaluation harness**: done (cases, code graders, record and replay, injection
  case; README "Evaluating the agent"). Next: an LLM judge with a rubric for
  what code cannot grade, checked against the rider's own ratings; a runner
  through Claude Code headless (`claude -p` with the MCP server) so live evals
  run on the subscription; more cases (edits, follow-ups, Codex).

- **OpenTelemetry**: export of logged sessions done (`rides otel`). Next: live
  spans during a session, and the MCP server's tool calls as their own service.

- **Rides from an image**: done (`--image`, `/image`, pasted in MCP clients).
  GPX and KML import: done (`rides import`, `importRoute`; README "Importing
  a route someone shared").

## Done lately

- **Everything in one place**: a capability catalogue in the code drives the MCP
  help and `capabilities` tool, `rides help`, the guide page and the site list;
  a test fails when a tool or command is not in it.
- **Rate a stretch you rode** (`rate-stretch`, `rateStretch`): two ends, routed and
  shown to check, kept as a road rating with no roadbook; listed with `rated`,
  removable.
- **Rides keep what was ridden**: a change moves only rides still ahead and names
  them; rides done or past are shown, exported and reviewed with their own
  version; `keep` holds a planned ride on the previous version.
- **The day of a ride**: a ride's own rating that never marks a road, the briefing
  on a chosen ride (`today 7 saturday`), the start of a loop read from its first
  leg ("from Thuin", daylight at Thuin), and a repeat offering to ride the
  roadbook again.
- **Roadbooks change in place**: a saved change keeps the roadbook's number and
  its previous version (`versions`, `restore`, `copy`); planned rides follow,
  marked to refresh; leg ratings become road ratings so nothing rated is lost.
- **Delete, cancel, tidy**: deleting a roadbook or a ride asks first and says
  what goes (road ratings stay); a planned ride can be cancelled and kept;
  `rides tidy` drops expired lookups and compacts the library, listing
  backups without deleting them; the MCP server drops expired lookups at
  start.
- **Roadbooks and rides** (ADR 0022, 0023): versioned library migrations with
  a backup first; saved rides stored as roadbooks (the design) and rides (a
  roadbook on a day); both listed 20 per page in the terminal and over MCP.
  Edits in place with versions and a new date as a new ride are done (below).
  Done since: the day's own rating, the start read from the first leg, the
  briefing on a chosen ride, overlap offering to ride the roadbook again.
- **A map of the ride**: the loop, towns, stops and fixed cameras with their
  limits as a picture, drawn from the ride's own data (`rides map`, `/map`,
  `showRideMap` in Claude Code or Codex, the Markdown export, the share page).
  Next, maybe: a real map background through a provider that allows static
  images, with its own key.
- **Road memory** (`recallArea`, ADR 0020): rides, ratings, scout verdicts and
  known winding roads from past sessions, recalled by place and by words.
  Next: measure it live (tokens and scouts on a second visit to a region,
  with and without memory), and a semantic layer only if the evals show
  misses.
- **Rating from Claude Code or Codex** (`rateRide`): the last gap between the
  terminal and the MCP mode.
- **MCP quality**: all four tool hints on every tool, every tool tested by name
  through a client, a maintained QR library.

## Open questions

- **How strict on fast expressways.** The ceiling is now a setting (25% by
  default: `--max-fast-pct`, `RIDE_MAX_FAST_PCT`, `/fast`, `maxFastPct`). Still
  open: whether 100 or 110 km/h is the right threshold per country, and whether
  "no motorways" should steer the router harder off them than its half weight.

## Smaller items

- Rain-free window finder over the next 16 days for a saved ride.
- Points of interest and elevation per leg.
- Background cameras and stops after the itinerary.
- Named bike profiles; database backup command; calendar (ICS) file.
- Multi-day trips with overnight stops; group rides with a meeting point.
