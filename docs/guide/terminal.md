# The terminal app

The terminal app's commands, in one place; the [reference](/reference) has
the complete help texts, generated from the code. Planning uses your Anthropic
API key; the library commands (`npm run rides -- ...`) never call a model.

## Planning: `npm run ride`

```bash
npm run ride                      # start menu: plan a new ride, or open a roadbook (20 per page, n and p to turn)
npm run ride -- [options] "..."   # plan directly
```

| Option                  | Effect                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `--from <place>`        | Start and end point: a town, a street or address, or `"lat,lon"`. Default `RIDE_HOME`        |
| `--roadbook <id\|name>` | Work on a roadbook (also `--ride`): with a request, apply it; without, open the prompt on it |
| `--show <id\|name>`     | Display a roadbook and exit, no model call                                                   |
| `--image <file>`        | Attach a photo of a map or a route screenshot (repeatable)                                   |
| `--allow-motorways`     | Permit motorways, e.g. for a commute                                                         |
| `--max-30-pct <n>`      | Target for zones of 30 km/h or less (default 3)                                              |
| `--max-50-pct <n>`      | Target for 31-50 km/h zones (default 20)                                                     |
| `--max-fast-pct <n>`    | Ceiling for fast expressways on a leisure ride (default 25; 100 turns the check off)         |
| `--allow-repeat`        | Accept rides that repeat saved ones                                                          |
| `--save-as <name>`      | Save the first itinerary under this name                                                     |
| `--once`                | Print the itinerary and exit, without the `refine>` prompt                                   |

## At the `refine>` prompt

Type a change in plain words ("too long, keep it under 180 km"), or a command:

| Command                         | Effect                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/save [name]`                  | Save the itinerary; on a roadbook, change it in place (`--copy` for a separate one, `--force` for a repeat) |
| `/show [id\|name]`              | Show a roadbook, by default the one of this session                                                         |
| `/roadbooks [page]`             | Roadbooks (saved loops and trips), 20 per page                                                              |
| `/rides [page]`                 | Rides (a roadbook on a day), latest date first, 20 per page                                                 |
| `/plan <day> [time]`            | A ride from this saved roadbook on a day, no copy, no model                                                 |
| `/gpx [file]`                   | GPX of the itinerary on screen, saved or not                                                                |
| `/md [file]`                    | Markdown document of the saved roadbook                                                                     |
| `/qr`, `/share`                 | QR code of the map link, or a page for the phone on your Wi-Fi                                              |
| `/image <file> [text]`          | Attach a map photo or route screenshot                                                                      |
| `/note <text> [--back N]`       | During the ride: a note about the last N minutes                                                            |
| `/rate <0-5> [note]`            | Rate the ride of this session                                                                               |
| `/motorways on\|off`            | Permit or forbid motorways from now on                                                                      |
| `/fast <0-100>`                 | Fast-expressway ceiling from now on                                                                         |
| `/bike [range=.. pause=..]`     | Show or set the bike profile                                                                                |
| `/settings`, `/usage`, `/trace` | Settings in force, what the session cost, its steps so far                                                  |
| `/back` (Ctrl-D), `/quit`       | Back to the menu, or quit                                                                                   |

Leaving with an itinerary that is not saved asks once. The conversation lives
in memory only: save the ride to pick it up later with `--roadbook`.

## The library: `npm run rides -- <command>`

| Command                                                                                | Does                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `roadbooks [--page N]`, `rides [--page N]`                                             | The saved loops, newest first; the rides by date; 20 per page                              |
| `show <roadbook> [day] [--md]`                                                         | One roadbook with its versions and rides, or one ride with the route it rode               |
| `plan <roadbook> <day> [time]`                                                         | A ride from a roadbook on a day, no copy, no model call                                    |
| `today [roadbook] [day]`                                                               | Ride-day briefing: go, caution or no-go (default the next planned ride)                    |
| `rate <roadbook> <0-5> [note]`, `rate-leg <roadbook> <leg> <0-5> [note]`               | Rate the roads: a roadbook or one leg                                                      |
| `rate-day <roadbook> <day> <0-5> [note]`                                               | Rate how a ride went that day, never the roads                                             |
| `rate-stretch "<from>" "<to>" <0-5> [note] [--via "<place>"]`                          | Rate a stretch of road you rode, without a roadbook                                        |
| `rated`, `unrate-stretch <id> [--yes]`                                                 | Every rating that steers plans; remove a stretch rating                                    |
| `note "<text>" [--rating 0-5] [--back N] [--roadbook id]`                              | During the ride: a note                                                                    |
| `notes [--all]`, `review [roadbook] [track.gpx] [--yes]`                               | Notes waiting; review against a recorded track                                             |
| `versions <roadbook>`, `restore <roadbook> <version>`, `copy <roadbook> [name]`        | Earlier versions, bring one back, a separate variant                                       |
| `keep <roadbook> <day>`                                                                | A planned ride stays on the route it had before a change                                   |
| `cancel <roadbook> <day>`                                                              | Not riding: kept, shown as cancelled                                                       |
| `delete roadbook <roadbook>`, `delete ride <roadbook> <day>`                           | Delete, after you confirm (`--yes` in scripts); road ratings stay                          |
| `import <file.gpx\|kml> [name] [--force]`                                              | Save a route someone shared                                                                |
| `export <roadbook> [file] [--pins N]`, `export-md <roadbook> [file]`, `map <roadbook>` | GPX for a GPS app, Markdown document, map picture                                          |
| `qr <roadbook>`, `share <roadbook>`                                                    | QR code, or the phone page on your Wi-Fi until Ctrl-C                                      |
| `refresh <roadbook\|all> [--stops]`                                                    | Recompute figures, weather, cameras, stops                                                 |
| `bike [range=.. reserve=.. pause=.. stint=.. lunch=..]`                                | Bike profile                                                                               |
| `runs [--csv]`, `trace <run> [--full]`, `otel <run>`                                   | Sessions with cost, replay one, export it to OpenTelemetry ([how to read them](/sessions)) |
| `tidy`, `clear-cache`                                                                  | Drop expired lookups and compact the file; drop all cached lookups                         |

## Checks

```bash
npm run check     # what is ready, and whether the map and weather services answer
npm run smoke     # every tool once against the live services, no model
```
