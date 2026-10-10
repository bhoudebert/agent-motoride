# Everything you can do

<!-- Generated from src/capabilities.ts by npm run docs:reference. Do not edit by hand. -->

Every feature of agentMotoride, by moment. In Claude Code or Codex, say it in
plain words (the **Say** column); in Claude Code, slash commands are
shortcuts. In the terminal, use the commands; `npm run rides -- help` prints
this list, and `/mcp__ride__help` (or asking "what can you do?") shows it in
Claude Code or Codex. Every option is in the [reference](/reference).

## Plan

| What                                                                                                    | Say                                                              | Terminal                                                                | Shortcut                                          |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Plan a new ride from one sentence: scouts explore two to four areas, the best loop comes back checked   | "a twisty loop on Saturday, no rain, under 200 km, leaving at 9" | `npm run ride -- "<request>"`<br>`npm run ride (menu)`                  | `/mcp__ride__plan-ride <request>`                 |
| Ride a saved roadbook again on a day: that day's forecast, open stops and a go or no-go, no copy        | "plan a ride from roadbook 7 on Saturday at 9"                   | `npm run rides -- plan <roadbook> <day> [time]`<br>`/plan <day> [time]` | `/mcp__ride__plan-from <roadbook> <day> [time]`   |
| A practical trip: point to point, motorways allowed, traffic checked                                    | "I need to be in Brussels by 9 on Monday"                        | `npm run ride -- --allow-motorways "<trip>"`                            | `/mcp__ride__commute <destination> <when> [from]` |
| Change a roadbook in words: changed in place, the previous version kept, rides already ridden untouched | "make roadbook 7 50 km longer, lunch in Die"                     | `npm run ride -- --roadbook <id> "<change>"`                            | `/mcp__ride__edit-ride <id\|name> <change>`       |
| Import a route someone shared (GPX or KML): routed and measured like your own                           | "import ~/Downloads/route.gpx"                                   | `npm run rides -- import <file.gpx\|kml> [name]`                        |                                                   |
| Plan from a photo of a map, a route screenshot or a list of places                                      | "(attach the picture) plan this loop"                            | `npm run ride -- --image <file>`<br>`/image <file>`                     |                                                   |
| Save the itinerary on the table as a roadbook                                                           | "save it as Monts de Flandre"                                    | `/save [name]`<br>`/save --copy [name]`                                 | `/mcp__ride__save-ride [name]`                    |

## Ride day

| What                                                                                    | Say                                          | Terminal                                                                                                                                       | Shortcut                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Morning briefing: fresh forecast, daylight, traffic, stops open at arrival, go or no-go | "briefing for Saturday's ride of roadbook 7" | `npm run rides -- today [roadbook] [day]`                                                                                                      | `/mcp__ride__today [id\|name]`            |
| The whole ride on one map: the loop, towns, stops and every fixed camera with its limit | "show me roadbook 7 on a map"                | `npm run rides -- map <roadbook>`<br>`/map`                                                                                                    |                                           |
| For the GPS and the phone: GPX, navigation links, a QR code, a page on your Wi-Fi       | "export roadbook 7 as GPX"                   | `npm run rides -- export <roadbook>`<br>`npm run rides -- qr <roadbook>`<br>`npm run rides -- share <roadbook>`<br>`/gpx`<br>`/qr`<br>`/share` | `/mcp__ride__export-gpx [id\|name]`       |
| A Markdown document of the ride, with its map, for your notes                           | "export roadbook 7 as Markdown"              | `npm run rides -- export-md <roadbook>`<br>`/md`                                                                                               | `/mcp__ride__export-md <id\|name> [file]` |

## On the road

| What                                                                             | Say                       | Terminal                                                          | Shortcut                  |
| -------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- | ------------------------- |
| A note about the last minutes, said at a stop: placed on the road after the ride | "last 10 minutes awesome" | `npm run rides -- note "<text>" [--rating 0-5]`<br>`/note <text>` | `/mcp__ride__note <text>` |

## After the ride

| What                                                                                                  | Say                                                                          | Terminal                                                                                                                | Shortcut                                            |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Review with your recorded track: notes placed on the road you rode, detours, pace, ratings to confirm | "review my ride with ~/Downloads/track.gpx"                                  | `npm run rides -- review [roadbook] [track.gpx]`<br>`npm run rides -- notes`                                            | `/mcp__ride__review [gpxPath] [ride]`               |
| Rate a roadbook or one of its legs: 4-5 sought out by later plans, 0-1 avoided                        | "rate roadbook 7 five, superb; leg 2: never again, gravel"                   | `npm run rides -- rate <roadbook> <0-5> [note]`<br>`npm run rides -- rate-leg <roadbook> <leg> <0-5> [note]`<br>`/rate` | `/mcp__ride__rate <roadbook> <0-5> [note]`          |
| Rate how the day went (weather, traffic, company), apart from the roads                               | "Saturday on roadbook 7 was cold, 2 out of 5"                                | `npm run rides -- rate-day <roadbook> <day> <0-5> [note]`                                                               |                                                     |
| Rate a stretch of road you rode, outside any roadbook                                                 | "the stretch from Rue de Longuesault 1, Tournai to Hollain was very nice, 5" | `npm run rides -- rate-stretch "<from>" "<to>" <0-5> [note]`                                                            | `/mcp__ride__rate-stretch <from> <to> <0-5> [note]` |
| See every rating that steers your plans, and remove a stretch rating                                  | "which roads have I rated?"                                                  | `npm run rides -- rated`<br>`npm run rides -- unrate-stretch <id>`                                                      |                                                     |

## Your library

| What                                                                                                  | Say                                                                | Terminal                                                                                                                                                                                                    | Shortcut                            |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Your roadbooks (saved loops) and your rides (a roadbook on a day), 20 per page                        | "list my roadbooks; my latest rides"                               | `npm run rides -- roadbooks [--page N]`<br>`npm run rides -- rides [--page N]`<br>`/roadbooks`<br>`/rides`                                                                                                  | `/mcp__ride__list-roadbooks [page]` |
| Everything about a roadbook (versions, rides), or one ride with the route it rode                     | "show roadbook 7; show Saturday's ride of roadbook 7"              | `npm run rides -- show <roadbook> [day]`<br>`/show`                                                                                                                                                         | `/mcp__ride__show-ride <id\|name>`  |
| Versions of a roadbook: bring one back, copy it as a variant, keep a planned ride on the previous one | "undo that change on roadbook 7; copy roadbook 7 as Short Flandre" | `npm run rides -- versions <roadbook>`<br>`npm run rides -- restore <roadbook> <version>`<br>`npm run rides -- copy <roadbook> [name]`<br>`npm run rides -- keep <roadbook> <day>`                          |                                     |
| Recompute a roadbook with today's map data, or only its stop plan                                     | "refresh roadbook 7"                                               | `npm run rides -- refresh <roadbook\|all> [--stops]`                                                                                                                                                        | `/mcp__ride__refresh <id\|name>`    |
| Cancel a planned ride, delete a ride or a roadbook (asked first; road ratings stay), tidy the file    | "I'm not riding Saturday; delete roadbook 7"                       | `npm run rides -- cancel <roadbook> <day>`<br>`npm run rides -- delete roadbook <roadbook>`<br>`npm run rides -- delete ride <roadbook> <day>`<br>`npm run rides -- tidy`<br>`npm run rides -- clear-cache` |                                     |

## Settings

| What                                                                            | Say                                                                             | Terminal                                                                                                                    | Shortcut |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| Start point, motorways, slow-zone targets, the fast-expressway ceiling, repeats | "allow motorways; aim for 10% in 50 zones; allow up to 40% of fast expressways" | `npm run ride -- --from <place> --allow-motorways --max-fast-pct <n>`<br>`/motorways on\|off`<br>`/fast <n>`<br>`/settings` |          |
| Your bike: tank range, reserve, pause interval, lunch                           | "my bike does 300 km on a tank, pause every hour and a half"                    | `npm run rides -- bike [range=… reserve=… pause=… stint=… lunch=…]`<br>`/bike`                                              |          |

## Under the hood

| What                                                                                  | Say                                | Terminal                                                                                                                            | Shortcut           |
| ------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| What each session did and cost, step by step, and its export to an observability tool | "(terminal) npm run rides -- runs" | `npm run rides -- runs [--csv]`<br>`npm run rides -- trace <run> [--full]`<br>`npm run rides -- otel <run>`<br>`/usage`<br>`/trace` |                    |
| This list                                                                             | "what can you do?"                 | `npm run rides -- help`<br>`/help`<br>`/back`<br>`/quit`                                                                            | `/mcp__ride__help` |
