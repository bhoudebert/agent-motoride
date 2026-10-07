# agentMotoride

[![CI](https://github.com/bhoudebert/agent-motoride/actions/workflows/ci.yml/badge.svg)](https://github.com/bhoudebert/agent-motoride/actions/workflows/ci.yml)
[![CodeQL](https://github.com/bhoudebert/agent-motoride/actions/workflows/codeql.yml/badge.svg)](https://github.com/bhoudebert/agent-motoride/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/bhoudebert/agent-motoride?display_name=tag&sort=semver)](https://github.com/bhoudebert/agent-motoride/releases)
[![Node 24](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)](.nvmrc)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=white)](CONTRIBUTING.md)
[![M8ven Score](https://m8ven.ai/badge/mcp/bhoudebert-agent-motoride-1xmac8?variant=verified)](https://m8ven.ai/mcp/bhoudebert-agent-motoride-1xmac8?s=readme)

A motorcycle ride planner driven by an AI agent. You say what you want in one
sentence:

> This Saturday, no rain, under 250 km, winding roads, give me an itinerary

and you get a ride you can follow: the loop, the roads, estimated riding time,
how much of it is open road, the forecast along the way, sunrise and sunset,
fixed speed cameras, where to fuel and where to stop for coffee, and the links
and files to put it on your phone.

The agent decides where to look and what to propose. Everything it states comes
from tools: road geometry and speed limits from OpenStreetMap, routing from
Valhalla, forecasts from Open-Meteo, traffic from TomTom when you have a key.
The code enforces your hard rules (no motorways unless you say so, a loop you
already have is never silently duplicated) and keeps your library: **roadbooks**,
the loops you designed and rated, and **rides**, a roadbook on a given day. Ride
a loop again with "plan a ride from roadbook 7 on Saturday at 9"; a new plan
learns from what you rated, so the next one is different and better.

**How to use it, task by task, in the terminal and in Claude Code or Codex:** the
[rider's guide](https://bhoudebert.github.io/agent-motoride/guide/) (source in
[`docs/guide/`](docs/guide/)).

It is also a working example of an agentic application: tool use, parallel
sub-agents ("scouts"), schema-validated answers checked again by code, evals
recorded once and replayed for free, a prompt-injection test, a replayable and
exportable trace of every step, cost accounting and a benchmark of models, and
the same tools exposed over the Model Context Protocol.

![How agentMotoride works: the rider asks, the agent decides with scouts, the tools know, the code enforces, the library learns, the rider gets the itinerary and files](docs/how-it-works.png)

## Two ways to run it

The planning model can come from two places. The tools, the library, the
exports and the data are the same in both.

|                     | API mode                                            | MCP mode                                                                                |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| What runs the agent | This app, through the Anthropic API                 | Claude Code or Codex CLI (any MCP client), using this app as a tool server              |
| What you pay with   | An Anthropic API key, per token                     | Your Claude Code or Codex plan; scouts use the key if set, else Claude Code's subagents |
| How you talk to it  | A terminal app with a menu and a `refine>` prompt   | Plain words in Claude Code or Codex; slash commands as shortcuts in Claude Code         |
| Planning guidance   | A real system prompt, schema-validated final answer | The same instructions sent as the prompt's text; free-text answer                       |
| Model and effort    | `RIDE_MODEL`, `RIDE_EFFORT` in `.env` (Anthropic)   | The MCP client's own model: Claude in Claude Code, OpenAI models in Codex               |
| Best for            | Full control, benchmarks, scripted runs             | Daily use on a subscription, chatting about rides, and the phone through Remote Control |

Start with the one that matches what you have: an API key, Claude Code or
Codex.

**From your phone, with nothing to install**: a Claude Code or Codex session running on
any machine (your computer, a Raspberry Pi, a VPS) can be driven from the Claude
app or the ChatGPT app, with this server attached. See
[From your phone](https://bhoudebert.github.io/agent-motoride/guide/from-your-phone) in the guide, for the Claude app and
the ChatGPT app.

Whatever the mode, `npm run check` tells you what is missing and whether the
data services answer from your machine.

### API mode, in three commands

```bash
npm install
cp .env.example .env            # set ANTHROPIC_API_KEY and RIDE_HOME
npm run ride                    # start menu: plan a new ride or open a saved one
```

Or plan directly:

```bash
npm run ride -- --from "Grenoble" "this Saturday, no rain, under 250 km, winding roads"
```

### MCP mode, in three steps

```bash
npm install
cp .env.example .env            # set RIDE_HOME; ANTHROPIC_API_KEY only for the app's own scouts
claude                          # start Claude Code in this directory; approve the "ride" server
```

Then in Claude Code, in plain words:

```
plan me a ride this Saturday, no rain, under 250 km, winding roads
```

Details for each mode: [the terminal app](https://bhoudebert.github.io/agent-motoride/guide/terminal) and
[Claude Code and Codex](https://bhoudebert.github.io/agent-motoride/guide/claude-code-and-codex) in the guide.

## What you get

- **An itinerary** built from real data: legs with town names and main roads, distance, estimated riding time and average speed, open-road share, time at 70 km/h or more, slow-zone shares against your targets, daylight, weather by time of day, traffic, fixed cameras, a stop plan with times, navigation links.
- **Roadbooks and rides**: every loop you keep is a roadbook (points, legs, route line, ratings), ridden on as many days as you like. "Plan a ride from roadbook 7 on Saturday at 9" adds a ride with that day's forecast, open stops and go or no-go, without copying the loop and, in the terminal, without a model call. Lists of both, 20 per page; a rule keeps new plans from repeating a roadbook you have.
- **Changes that keep history**: "make roadbook 7 50 km longer" changes it in place and keeps the previous version (`versions`, `restore`, `copy` for a real variant). Rides already done keep the route they rode, for viewing, exports and the review; rides still ahead follow, and the save names them. A day has its own rating ("Saturday was cold, 2/5"), apart from the roads'. Deletes ask first and keep your road ratings; a planned ride can be cancelled; `tidy` compacts the library.
- **Rides from anywhere**: a sentence, a GPX or KML file someone shared, or a photo of a map.
- **Checked before you see it**: your distance and time limits, motorways, fast expressways (25% by default, your setting), repeats, rated roads and a departure already past verified by code, not by the model; a slow-zone share over its target is said, not hidden.
- **Feedback from the road**: say "last 10 minutes awesome" or "cobbles, never again" while riding; after the ride the notes land on the road you actually rode, from any app's recorded track, and become ratings the next plans follow.
- **Exports**: a map picture of the ride with its stops and cameras, Google Maps links pinned to the chosen roads, GPX for navigation apps (Liberty Rider, Kurviger, Garmin, TomTom), a Markdown document per ride, a QR code and a phone page on your Wi-Fi.
- **Accounting**: every run logged with tokens, cost and result; every step replayable; a model benchmark with recommendations.
- **Evals**: scripted rider requests graded by code, recorded once and replayed for free in CI, with a prompt-injection case planted in map data.

## The guide

How to use every feature, one task per page, the terminal and Claude Code or
Codex side by side: **[the rider's guide](https://bhoudebert.github.io/agent-motoride/guide/)**.

| Before the ride                                                                         | Ride day                                                                                    | Back home                                                                              | Reference                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Plan a ride](https://bhoudebert.github.io/agent-motoride/guide/plan-a-ride)            | [On the phone and the GPS](https://bhoudebert.github.io/agent-motoride/guide/phone-and-gps) | [Notes and review](https://bhoudebert.github.io/agent-motoride/guide/notes-and-review) | [Settings and rules](https://bhoudebert.github.io/agent-motoride/guide/settings)                 |
| [Import a route](https://bhoudebert.github.io/agent-motoride/guide/import-a-route)      | [From your phone](https://bhoudebert.github.io/agent-motoride/guide/from-your-phone)        | [Your library](https://bhoudebert.github.io/agent-motoride/guide/library)              | [The terminal app](https://bhoudebert.github.io/agent-motoride/guide/terminal)                   |
| [From a photo of a map](https://bhoudebert.github.io/agent-motoride/guide/from-a-photo) |                                                                                             |                                                                                        | [Claude Code and Codex](https://bhoudebert.github.io/agent-motoride/guide/claude-code-and-codex) |
| [Stops and your bike](https://bhoudebert.github.io/agent-motoride/guide/stops-and-bike) |                                                                                             |                                                                                        | [Limits and troubleshooting](https://bhoudebert.github.io/agent-motoride/guide/limits)           |
| [What to watch](https://bhoudebert.github.io/agent-motoride/guide/what-to-watch)        |                                                                                             |                                                                                        | [Getting started](https://bhoudebert.github.io/agent-motoride/guide/getting-started)             |

## How it is built

- **The model decides, tools supply every number, code enforces the rules.**
  Each tool is a plain function over a public data source; the rider's rules
  (no motorways, no repeats, the limits in the request) are checked in code,
  and a failed itinerary goes back to the planner once.
- **Scouts and memory**: two to four cheaper model sessions explore riding
  areas in parallel, or in Claude Code its own subagents at no API cost; before
  they go, a road memory built from past sessions (rides, ratings, scout
  verdicts from both kinds of scouts, known winding roads), recalled by place
  and by words with SQLite FTS5, tells the planner what is already known.
- **A library that evolves safely**: one SQLite file with versioned
  migrations, each in a transaction after a backup; roadbooks keep their
  versions, rides point to the one they used.
- **Two modes, one toolbox**: the terminal app runs the agent on the Anthropic
  API with a schema-validated answer; Claude Code and Codex use the same tools
  as an MCP server, with forms (elicitation) for the rider's decisions.
- **Evaluated and observable**: scripted rider requests graded by code,
  recorded once and replayed free in CI, a prompt-injection case planted in map
  data; every session traced, costed, replayable and exportable to
  OpenTelemetry.

Details in [`docs/ENGINEERING.md`](docs/ENGINEERING.md): architecture, tools
and data sources, the riding-time model, model choice and cost benchmark,
evals, observability, scripts and project layout. Every significant choice has
a decision record in [`docs/adr/`](docs/adr/).

## Requirements

- Node.js 24 or newer. The TypeScript sources run directly, there is no build step.
- API mode: an Anthropic API key from <https://platform.claude.com/>, billed per token.
- MCP mode: Claude Code, Codex or another MCP client. No API key needed: without one, Claude Code scouts with its own subagents.
- Internet access to the public data services listed in [the engineering notes](docs/ENGINEERING.md#tools).
- Optional: a TomTom API key (free tier at <https://developer.tomtom.com/>) for traffic checks.

## Licence, data and disclaimer

Open source under the MIT licence. The planner relies on public data and
services with their own licences, in particular OpenStreetMap (© OpenStreetMap
contributors, ODbL) and Open-Meteo (CC BY 4.0); see `NOTICE.md` for the full
list, the attribution each requires, and the usage policies of the public
instances.

Trademarks and product names mentioned here (Claude, Codex, Google Maps,
Liberty Rider, TomTom and others) belong to their owners; this project is
independent and not affiliated with or endorsed by any of them.

The app is a planning aid, not a navigation system: riding times are
estimates, public data can be wrong or outdated, and the rider is responsible
for the ride and for complying with the law, including local rules on
speed-camera information. Full text in `NOTICE.md`.

## Documentation map

| Where                                                                                           | What                                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [The rider's guide](https://bhoudebert.github.io/agent-motoride/guide/) ([source](docs/guide/)) | How to use every feature, in the terminal and in Claude Code or Codex                 |
| [`docs/ENGINEERING.md`](docs/ENGINEERING.md)                                                    | How it works, tools, riding-time model, models and cost, evals, observability, layout |
| [`docs/adr/`](docs/adr/)                                                                        | Architecture decision records: why the system is shaped the way it is                 |
| [`openspec/specs/`](openspec/specs/)                                                            | What the system does, as requirements with scenarios, one file per capability         |
| [`docs/EVOLVING.md`](docs/EVOLVING.md)                                                          | How the app evolves: idea, decision, spec, code in every mode, tests, docs, release   |
| [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md)                                  | Setup, commits and pull requests, for people and for coding agents                    |
| [`.env.example`](.env.example)                                                                  | Every setting with its default                                                        |
