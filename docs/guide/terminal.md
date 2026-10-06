# The terminal app

The terminal app's commands, in one place; the [reference](/reference) has
the complete help texts, generated from the code. Planning uses your Anthropic
API key; the library commands (`npm run rides -- ...`) never call a model.

## Planning: `npm run ride`

```bash
npm run ride                      # start menu: plan a new ride, or open a saved one
npm run ride -- [options] "..."   # plan directly
```

| Option              | Effect                                                                                |
| ------------------- | ------------------------------------------------------------------------------------- |
| `--from <place>`    | Start and end point: a town, a street or address, or `"lat,lon"`. Default `RIDE_HOME` |
| `--ride <id\|name>` | Work on a saved ride: with a request, apply it; without, open the prompt on it        |
| `--show <id\|name>` | Display a saved ride and exit, no model call                                          |
| `--image <file>`    | Attach a photo of a map or a route screenshot (repeatable)                            |
| `--allow-motorways` | Permit motorways, e.g. for a commute                                                  |
| `--max-30-pct <n>`  | Target for zones of 30 km/h or less (default 3)                                       |
| `--max-50-pct <n>`  | Target for 31-50 km/h zones (default 20)                                              |
| `--allow-repeat`    | Accept rides that repeat saved ones                                                   |
| `--save-as <name>`  | Save the first itinerary under this name                                              |
| `--once`            | Print the itinerary and exit, without the `refine>` prompt                            |

## At the `refine>` prompt

Type a change in plain words ("too long, keep it under 180 km"), or a command:

| Command                         | Effect                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| `/save [name]`                  | Save the itinerary; `--force` to keep a repeat of a saved ride |
| `/show [id\|name]`              | Show a saved ride, by default the one of this session          |
| `/list`                         | Saved rides                                                    |
| `/gpx [file]`                   | GPX of the itinerary on screen, saved or not                   |
| `/md [file]`                    | Markdown document of the saved ride                            |
| `/qr`, `/share`                 | QR code of the map link, or a page for the phone on your Wi-Fi |
| `/image <file> [text]`          | Attach a map photo or route screenshot                         |
| `/note <text> [--back N]`       | During the ride: a note about the last N minutes               |
| `/rate <0-5> [note]`            | Rate the ride of this session                                  |
| `/motorways on\|off`            | Permit or forbid motorways from now on                         |
| `/bike [range=.. pause=..]`     | Show or set the bike profile                                   |
| `/settings`, `/usage`, `/trace` | Settings in force, what the session cost, its steps so far     |
| `/back` (Ctrl-D), `/quit`       | Back to the menu, or quit                                      |

Leaving with an itinerary that is not saved asks once. The conversation lives
in memory only: save the ride to pick it up later with `--ride`.

## The library: `npm run rides -- <command>`

| Command                                                      | Does                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `list`, `show <id> [--md]`                                   | The library, one ride                                      |
| `today [id]`                                                 | Ride-day briefing: go, caution or no-go                    |
| `rate <id> <0-5> [note]`, `rate-leg <id> <leg> <0-5> [note]` | Rate a ride or a leg                                       |
| `note "<text>" [--rating 0-5] [--back N] [--ride id]`        | During the ride: a note                                    |
| `notes [--all]`, `review [id] [track.gpx] [--yes]`           | Notes waiting, review against a recorded track             |
| `import <file.gpx\|kml> [name] [--force]`                    | Save a route someone shared                                |
| `export <id> [file] [--pins N]`, `export-md <id> [file]`     | GPX for a GPS app, Markdown document                       |
| `qr <id>`, `share <id>`                                      | QR code, or the phone page on your Wi-Fi until Ctrl-C      |
| `refresh <id\|all> [--stops]`                                | Recompute figures, weather, cameras, stops                 |
| `bike [range=.. reserve=.. pause=.. stint=.. lunch=..]`      | Bike profile                                               |
| `runs [--csv]`, `trace <run> [--full]`, `otel <run>`         | Sessions with cost, replay one, export it to OpenTelemetry |
| `delete <id>`, `clear-cache`                                 | Remove a ride, drop cached lookups                         |

## Checks

```bash
npm run check     # what is ready, and whether the map and weather services answer
npm run smoke     # every tool once against the live services, no model
```
