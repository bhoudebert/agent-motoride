# What a session did

Every planning session, in the terminal or in Claude Code and Codex, is logged
with its cost and every step: what the model was told, each tool it called with
its inputs and results, what the scouts did, and the final answer.

## Every session, with its cost

```bash
npm run rides -- runs           # one line per session
npm run rides -- runs --csv     # the same, for a spreadsheet
```

| Column                                           | Meaning                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `run`, `date`                                    | the session's number and start                                                    |
| `model`, `effort`                                | the planner's model, or `mcp-client` for Claude Code and Codex                    |
| `turns`, `calls`, `tools`                        | your messages, model calls (scouts included), tool calls                          |
| `in`, `cache`, `out`                             | input tokens at full rate, tokens read from cache, output tokens                  |
| `secs`, `cost`                                   | how long the planner worked, tool calls included; estimated cost from list prices |
| `km`, `ride_min`, `open%`, `70+t%`, `50%`, `30%` | the ride it produced                                                              |
| `ride`, `status`, `request`                      | the roadbook saved from it, if any; ok or no ride; what you asked                 |

For `mcp-client` rows the tokens and cost are the scouts' only: the client's
own model is not visible to the app.

## One session, step by step

```bash
npm run rides -- trace 43          # the steps, one line each
npm run rides -- trace 43 --full   # with complete inputs and outputs
```

```
   0.0s  main                tool     listSavedRides({"location":"Thuin"})  0.1s  -> 12 saved ride(s) within 150 km
   0.0s  main                tool     recallArea({"location":"Thuin","radiusKm":60})  0.1s  -> {"centre":"Thuin, …
   9.6s  scout:Fagne Chimay  you      Area to scout: Fagne Chimay (around Chimay, Belgium). Start and end point …
  16.2s  scout:Fagne Chimay  tool     searchRoads({"location":"Chimay, Belgium","radiusKm":25})  31.4s  -> 52 roads, top: N978a (277) …
  65.6s  main                tool     scoutAreas({"areas":[{"name":"Viroinval Couvin",…}]})  56.0s  -> 4 report(s): …
 111.2s  main                tool     calculateTrip({"waypoints":["Thuin, Belgium",…]})  10.0s  -> r1: 122.3 km, 1h57, open 86.5% …
 319.3s  main                check    passed
```

- **`main`** is the planner; **`scout:<area>`** one scout. Scouts run in
  parallel, so their lines interleave.
- **`you`** is a message to a model (your request, or a scout's brief),
  **`tool`** a tool call with its duration and result, **`model`** a model
  response with its tokens, **`report`** a scout's verdict, **`check`** the
  code check of the answer.
- How to read the sequence: [How a plan is made](/how-a-plan-is-made).

## In an observability tool

```bash
npm run rides -- otel 43                 # to OTEL_EXPORTER_OTLP_ENDPOINT, else to a file
npm run rides -- otel last --file run.json
npm run rides -- otel 43 --content       # with prompts, answers and tool data
```

Each session becomes an OpenTelemetry trace, following the GenAI semantic
conventions: an agent span for the planner, one per scout nested under its
`scoutAreas` call, a span per model call and per tool call. It opens in Jaeger,
Grafana Tempo, Honeycomb or any OTLP tool. Without
`--content` only names, durations and token counts leave your machine;
`--content` adds what the steps contained, which includes your places and
routes.
