# Reference

Generated from the code by `npm run docs:reference`; CI fails when it is out
of date, so what is listed here is what the app does. For explanations, see the
task pages of this guide.

## The terminal app

### `npm run ride`

```text
Usage: npm run ride                              Start menu: plan a new ride or open a saved one
       npm run ride -- [options] "<what you want>"  Plan a ride directly

  npm run ride -- --from "Grenoble" "Roadtrip moto this Saturday, no rain, <250km, winding roads, give me an itinerary"
  npm run ride -- --roadbook 3 "50 km longer, lunch in Die"
  npm run ride -- "plan a ride from roadbook 3 on Saturday at 9"     a ride on a day, no copy, no model call

Options:
  --from <place>        Start and end point. Defaults to RIDE_HOME, or the roadbook's start with --roadbook.
  --show <id|name>      Display a saved ride and exit. No planning, no API call.
  --roadbook <id|name>  Work on a saved roadbook (also --ride). With a request: apply it. Without: open the prompt on it.
  --allow-repeat        Accept rides that repeat saved ones. Default: near-duplicates are rejected.
  --save-as <name>      Save the first itinerary under this name (useful with --once).
  --allow-motorways     Permit motorways (autoroutes), e.g. for a commute. Default: never used.
                        Also switchable during a session with /motorways on|off.
  --max-30-pct <n>      Target max % of distance in zones of 30 km/h or less. Default 3.
  --max-50-pct <n>      Target max % of distance in 31-50 km/h zones. Default 20.
  --once                Print the itinerary and exit, without the refine prompt.
  --image <file>        Attach a photo of a map, a screenshot of a route or a list of places (PNG, JPEG, WebP, GIF,
                        5 MB max; repeatable). The planner reads the places on it and routes them.

At the "refine>" prompt, type a change in plain words, or a command:
  /save [name]          Save the itinerary; on a saved roadbook, change it in place and keep the previous version.
                        --copy saves a separate roadbook instead; --force saves one that repeats a roadbook you have
  /roadbooks [page]     Roadbooks (the loops and trips you saved), newest first, 20 per page
  /rides [page]         Rides (a roadbook on a day), latest date first, 20 per page
  /plan <day> [time]    Plan a ride from this saved roadbook on a day (also: "plan a ride on Saturday at 9"); no copy
  /show [id|name]       Details of a saved ride (no argument: the one loaded or saved here)
  /gpx [file.gpx]       Export the current itinerary (or the loaded ride) as a GPX file
  /md [file.md]         Export the saved or loaded ride as a Markdown document, with its map (save first)
  /map [file.png]       A picture of the saved or loaded ride: route, towns, stops, cameras (save first)
  /qr                   QR code of the Google Maps link, to scan with the phone
  /share                Page for the phone on the local Wi-Fi (map link, itinerary, GPX download) with its QR code
  /rate <1-5> [note]    Rate the ride saved or loaded in this session
  /note <text> [--rating 0-5] [--back N]  During the ride: note about the last N minutes (default 10), reviewed after the ride
  /image <file> [text]  Attach a map photo or route screenshot: the planner reads the places on it and routes them
  /motorways on|off     Permit or forbid motorways from now on (default off)
  /settings             Show current settings: motorways, slow-zone targets, traffic
  /bike [range=250 ...] Show or set the bike profile (range, reserve, pause, stint, lunch) used for stops
  /usage                Model, tokens, time and estimated cost of this session so far
  /trace                Replay this session's steps so far (tool calls, scouts, answers)
  /back                 Leave this ride and return to the start menu (also Ctrl-D)
  /quit                 Quit the program (also exit, Ctrl-C)
  /help                 This list

Saved rides are managed with: npm run rides -- roadbooks | rides | show | rate | rate-leg | note | review | delete
Env equivalents: RIDE_ALLOW_MOTORWAYS=1, RIDE_MAX_30_PCT, RIDE_MAX_50_PCT.
Needs ANTHROPIC_API_KEY (see .env.example).
```

### `npm run rides`

```text
Usage: npm run rides -- <command>

  roadbooks [--page N]                  Roadbooks (the loops and trips you saved), newest first, 20 per page
  rides [--page N]                      Rides (a roadbook on a day), latest date first, 20 per page
  plan <roadbook> <day> [time]          Plan a ride from a roadbook: day as 2026-10-17, 17/10, saturday, tomorrow;
                                        time as 9, 9:30, 9h30 (default the roadbook's last departure). No copy, no model
  today [roadbook] [day]                Ride-day briefing: weather now, daylight, traffic, stops checked against opening hours, go or no-go
                                        (default the next planned ride; with a day, that ride of the roadbook)
  show <id|name> [--md]                 One ride: legs, map link, itinerary (--md: as Markdown on stdout)
  export-md <id|name> [file.md]         Write the ride as a Markdown document, with its map (default: exports/ in the project)
  map <id|name> [file.png]              A picture of the ride: route, towns, stops, fixed cameras with their limits
  rate <id|name> <0-5> [note]           Rate a roadbook: its roads, for later plans (0 never again, 5 loved)
  rate-day <roadbook> <day> <0-5> [note]  Rate how a ride went that day (weather, traffic, company); never a road rating
  rate-leg <id|name> <leg> <1-5> [note] Rate one leg of a ride
  note "<text>" [--rating 0-5] [--back N] [--roadbook id|name]
                                        During the ride: a note about the last N minutes (default 10), on today's ride
  notes [--all]                         Notes waiting for review (--all: reviewed and dismissed ones too)
  review [id|name] [track.gpx] [--yes]  After the ride: place the notes on the recorded track (or on the plan without one),
                                        show detours and pace, then confirm a rating per road stretch (--yes: accept all proposals)
  export <id|name> [file.gpx] [--pins N]  Write the ride as a GPX file (default: exports/ in the project); --pins caps the route points
  qr <id|name>                          QR code of the ride's Google Maps link
  share <id|name>                       Serve the ride to the phone on the local Wi-Fi (QR code), until Ctrl-C
  trace <run> [--full]                  Replay a planning session step by step (run ids from "runs")
  otel <run|last> [--content] [--file out.json]
                                        Export a session as OpenTelemetry traces to OTEL_EXPORTER_OTLP_ENDPOINT, else to a file;
                                        --content adds prompts, answers and tool data (they hold your places and routes)
  bike [range=250 reserve=40 pause=75 stint=90 lunch=yes]   Show or set the bike profile used to plan stops
  runs [--csv]                          Every planning session with model, effort, tokens, cost and result
  refresh <id|name|all> [--stops]       Route a saved ride again: distance, times, road mix, leg names, daylight, cameras, stops
                                        --stops: only rebuild the stop plan from the bike profile (instant when the stops are cached)
  import <file.gpx|file.kml> [name] [--force]
                                        Save a route someone shared: routed like a planned ride (figures, stops, cameras),
                                        with waypoints added until it follows the file; --force saves a duplicate anyway
  delete roadbook <id|name> [--yes]     Delete a roadbook with its rides and notes, after you confirm (road ratings stay)
  delete ride <roadbook> <day> [--yes]  Delete one ride of a roadbook, e.g. delete ride 7 2026-10-10, after you confirm
  cancel <roadbook> <day>               Cancel a planned ride: kept, shown as cancelled
  versions <roadbook>                   Earlier versions of a roadbook: each change keeps the design it replaced
  restore <roadbook> <version>          Bring back an earlier version; the current one is kept as a version too
  copy <roadbook> [name]                A separate roadbook with the same design, to change on its own
  tidy                                  Drop expired lookups and compact the library; lists backups and old files, deletes none
  clear-cache                           Drop cached road, route and weather lookups

Ratings steer later planning: legs, rides and road stretches rated 4-5 are
reused as building blocks, those rated 0-1 are avoided.
```

## Claude Code and Codex (MCP server)

34 tools, 15 prompts. Each tool shows its MCP hints: a client can let read-only tools run without asking.

### Tools

#### `listSavedRides`

_read-only · local only_

The rider's library of saved rides near a place, with rating (1-5, null if not ridden yet), notes, waypoints and legs. Each leg has coordinates usable directly as calculateTrip waypoints, its main roads, and its own rating when the rider gave one. roadRatings are stretches the rider rated after riding them. Call it once at the start: legs and stretches rated 4-5 are proven building blocks, those rated 0-1 are roads to stay away from, and anything already saved is ground the rider has covered.

- `location` (string, optional): Centre of the search, default the rider's start point
- `radiusKm` (number, optional): Default 150

#### `recallArea`

_read-only · uses online services_

What the app already knows around a place, from earlier sessions: saved rides with their ratings, stretches the rider loved (4-5) or avoids (0-1), areas scouts already visited with their verdict, open-road share and age in days, and known winding roads with curviness and from/to coordinates usable directly as calculateTrip waypoints. With words (query), also the best matches anywhere, e.g. a road ref or a village. Call it before scouting or searching roads in a region: do not scout again an area recently found poor without a reason, and route known winding roads directly instead of a new road search. Weather is never remembered.

- `location` (string): Centre of the region, e.g. the start point or a candidate area
- `radiusKm` (number, optional): Default 40
- `query` (string, optional): Words to look for anywhere: a road, a village, cobbles...

#### `getWeather`

_read-only · uses online services_

Hourly weather forecast for one place on one day (up to 16 days ahead): temperature, rain probability and amount, wind, gusts, sky. Call it for the start point and for several points along a candidate route, covering the hours the rider would actually be there.

- `location` (string): Town ("Florac", "Vannes, France"), street or address ("Avenue de Bretagne, Lille"), or "lat,lon" coordinates
- `date` (string): Day to forecast, YYYY-MM-DD
- `fromHour` (integer, optional): First local hour to include, default 8
- `toHour` (integer, optional): Last local hour to include, default 20

#### `searchRoads`

_read-only · uses online services_

Find winding paved secondary/tertiary roads and mountain passes around a place, from OpenStreetMap. Roads are ranked by curvinessDegPerKm (cumulative heading change per km: under 200 mostly straight, 200-400 flowing bends, over 400 properly twisty mountain road); areaMedianCurviness tells you how twisty the area is overall. Each road comes with `from`/`to` coordinates usable as waypoints in calculateTrip. Search around an area you expect to be good riding country, not around a city centre.

- `location` (string): Town ("Florac", "Vannes, France"), street or address ("Avenue de Bretagne, Lille"), or "lat,lon" coordinates
- `radiusKm` (number, optional): Search radius, default 25, max 40
- `minLengthKm` (number, optional): Ignore roads shorter than this, default 5
- `limit` (integer, optional): Max roads returned, default 12

#### `calculateTrip`

_read-only · uses online services_

Route through waypoints in order with a motorcycle profile. Returns a routeId identifying this exact routed trip, real road distance, and per leg and in total: estimated riding time and average speed (from each road segment's speed limit and bends, without stops or traffic; the router's own pessimistic time is given as routerUpperBoundTime), main roads, and a Google Maps link. speedLimits gives openRoadPct (share of distance outside built-up areas and off motorways, the figure to maximise), km and percent in zones of 30 km/h or less and of 31-50 km/h (untagged streets in built-up areas are counted as 50 zones), above 50, and untagged open road (assumed at the legal default of its country and region), plus the longest 30 and 50 stretches by road name so you can move waypoints to bypass them. savedRides compares the route with the rider's saved rides: a verdict plus the percent of this route that runs on roads of each similar saved ride. ratedRoads tells how much of it runs on roads the rider rated 0-1 (avoid) or 4-5 (loved). speedLimits.surface gives the km on cobbles or setts and on unpaved surfaces, with the stretches by road. speedLimits.fastExpressway gives the km and share on roads that are not motorways but are limited to 100 km/h or more (expressways), with the longest stretches: keep it small for a leisure ride. Motorways: the result says whether the rider currently permits them (motorwaysPermitted) and whether this trip was routed with them excluded (motorwaysAvoided). When they are not permitted they are excluded whatever you pass; if usesMotorway is still true, no motorway-free route exists between those waypoints and they must be changed. When they are permitted, pass avoidMotorways false to let the router take them where faster. Use it to check every candidate loop; straight-line guesses are not reliable on winding roads.

- `waypoints` (string[]): Ordered stops, each a town, a street or address, or "lat,lon". First one is the start. At most 10 locations in all: a round trip's return to the start counts as one.
- `roundTrip` (boolean, optional): Return to the first waypoint at the end, default false
- `avoidMotorways` (boolean, optional): Default true. False takes motorways where faster, and only has effect when the rider permits motorways

#### `importRoute`

_read-only · uses online services_

Turn a route file the rider has (GPX track or route, KML line; a path on this machine) into a routed trip: its line is reduced to waypoints and routed with the motorcycle profile, with waypoints added where the router strays from the file. Returns a routeId like calculateTrip, with the same figures and checks, plus fidelityPct (share of the file's line the routed trip follows; under 90% say where it differs, e.g. motorways avoided), the file's name and length, and the waypoints used, which you can edit and route again with calculateTrip. Present, finish and save it like any planned ride.

- `file` (string): Path of the .gpx or .kml file

#### `getTraffic`

_read-only · uses online services_

Expected traffic along a route for a given departure time: travel time with traffic, free-flow time and the delay between them. Meant for the final loop once it is chosen on road data, not for comparing candidates. trafficDelayMinutes is the expected congestion for that departure (travel time minus free-flow time); incidentDelayMinutes is the part due to reported incidents. Report trafficDelayMinutes on top of the riding-time estimate from calculateTrip. May report that no traffic source is configured; in that case say so in the answer instead of estimating.

- `waypoints` (string[]): Ordered stops, each a town, a street or address, or "lat,lon". First one is the start. At most 10 locations in all: a round trip's return to the start counts as one.
- `departAt` (string): Local departure date-time, e.g. 2026-10-03T09:00:00
- `roundTrip` (boolean, optional): Return to the first waypoint at the end, default false
- `avoidMotorways` (boolean, optional): Use the same value as the calculateTrip call for this route. Default true

#### `getDaylight`

_read-only · uses online services_

Sunrise, sunset, first and last usable light, and daylight hours for a place and a date, any date. Use it to set the departure time and to check the return is before sunset; weather results carry the same figures for the forecast day.

- `location` (string): Town ("Florac", "Vannes, France"), street or address ("Avenue de Bretagne, Lille"), or "lat,lon" coordinates
- `date` (string): YYYY-MM-DD

#### `getSpeedCameras`

_read-only · uses online services_

Fixed speed cameras mapped in OpenStreetMap on or beside a routed trip, with position along the route, leg, posted limit and direction. Call it for the final loop so the itinerary can warn where to watch the speed. Fixed cameras only, no mobile controls, and only those mappers recorded.

- `routeId` (string): routeId from calculateTrip

#### `findStops`

_read-only · uses online services_

Fuel stations, cafés, restaurants and bakeries within a short detour of a routed trip, ordered by distance from the start, with opening hours when mapped. Use it on the final loop to place a fuel stop within the tank range and a coffee or lunch stop at a sensible point, and name them in the itinerary.

- `routeId` (string): routeId from calculateTrip
- `kinds` ("fuel" \| "cafe" \| "restaurant" \| "bakery"[], optional): Default fuel and cafe
- `radiusM` (integer, optional): Max detour from the route in metres, default 400
- `limitPerKind` (integer, optional): Default 15

#### `planStops`

_read-only · uses online services_

Choose the stops of a routed trip from the rider's bike profile: the last fuel station before each fuel deadline (tank range minus reserve, from the fuel at departure), a café or bakery pause after the pause interval, a restaurant where the ride crosses midday, preferring places open at the arrival time when the ride date is given. Returns the stops with arrival times and whether each is open, the return time with breaks, warnings (no fuel in reach, long stint), and navigation links that include the stops so they are announced on the bike. Call it once for the final loop, after calculateTrip, and name the stops in the itinerary. findStops is only for browsing alternatives.

- `routeId` (string): routeId from calculateTrip
- `departure` (string): Planned departure time, HH:MM
- `date` (string, optional): Ride date, to check opening hours at arrival
- `fuelAtStartKm` (number, optional): Range left in the tank at departure, km; default a full tank

#### `checkConditions`

_read-only · uses online services_

Crosswind and low-sun glare along a routed trip for a date and departure: stretches where gusts blow 35 km/h or more across the direction of travel (50 or more: strong), and stretches where the sun is low (0-15 degrees) within 30 degrees ahead at the time of passage. Wind needs the date within 16 days; glare works for any date. Call it on the final loop and name any stretch in the itinerary; a long glare stretch on the way home can be a reason to leave earlier.

- `routeId` (string): routeId from calculateTrip
- `date` (string): Ride date, YYYY-MM-DD
- `departure` (string): Departure time, HH:MM

#### `scoutAreas`

_read-only · uses online services_

Send one scout per area, in parallel, to find the best loop from the start point through that area within the constraints. Each scout searches roads, assembles and routes a loop, reads its open-road and slow-zone shares, checks the weather, and reports a candidate with its routeId, which you can present directly or route again (free, cached) to refine. Use it once at the start of a new leisure ride with 2 to 4 areas; not for edits, questions or practical trips. Give each area a name and a central town or village of good riding country, not a city.

- `areas` (object[])
- `rideDate` (string): Ride day, YYYY-MM-DD
- `departure` (string): Planned departure time, HH:MM
- `maxDistanceKm` (number,null): Hard distance cap from the rider's request, or null
- `maxRidingMinutes` (number,null): Hard riding-time cap in minutes, or null
- `constraints` (string): The rider's request and constraints, in one paragraph, as scouts will not see the conversation
- `start` (string,null, optional): Start and end point of the loops when the request names one other than the rider's home ("from Thuin"): town or "lat,lon". Omit for the home

#### `rideSettings`

_writes · not destructive · idempotent · uses online services_

Show or change the rider's settings for this session: start and end point, whether motorways are permitted, and the slow-zone targets. Call it first with the home when the rider has not set one. Returns the settings in force.

- `home` (string, optional): Start and end point: town, address or "lat,lon"
- `allowMotorways` (boolean, optional)
- `max30Pct` (number, optional)
- `max50Pct` (number, optional)
- `allowRepeat` (boolean, optional): Accept rides that repeat saved ones
- `tankRangeKm` (number, optional): Bike profile: realistic range on a full tank
- `reserveKm` (number, optional): Bike profile: fuel this many km before the range runs out
- `pauseEveryMin` (number, optional): Bike profile: pause after this much riding
- `maxStintMin` (number, optional)
- `lunch` (boolean, optional): Bike profile: plan a lunch stop when the ride spans midday

#### `checkItinerary`

_read-only · local only_

Check an itinerary in code before presenting it: routed distance and riding time against the caps in the rider's words, motorways when forbidden, repeats of saved rides, roads rated 0-1, and the distance stated in your text against the routed one. Returns PASS, or what failed. Fix the itinerary once and check again, or say plainly in the answer which limit cannot be met.

- `routeId` (string): routeId of the itinerary, from calculateTrip
- `request` (string): The rider's request, in their words
- `itinerary` (string): The itinerary text you are about to present

#### `saveRide`

_writes · not destructive · not idempotent · uses online services_

Save an itinerary to the rider's library. Only when the rider asks to save. routeId must be one returned by calculateTrip in this session; the saved distances and geometry come from that routed trip. A ride that duplicates a saved one (70% or more of the same roads) is refused; pass force only when the rider explicitly wants a copy. Returns the saved ride id.

- `routeId` (string)
- `name` (string): A few words a rider would recognise the ride by
- `rideDate` (string,null): YYYY-MM-DD or null
- `departure` (string,null): HH:MM or null
- `itinerary` (string): The itinerary text as presented to the rider
- `request` (string): What the rider asked for, in one line
- `force` (boolean, optional): Save even if it duplicates a saved ride; only on the rider's explicit wish
- `asCopy` (boolean, optional): Save as a separate roadbook instead of changing the one being worked on; only when the rider wants a copy or variant

#### `exportGpx`

_writes · may overwrite · idempotent · uses online services_

Write a ride as a GPX file for a GPS app: either a routeId from this session or the id of a saved ride. Returns the file path.

- `routeId` (string, optional)
- `rideId` (integer, optional)
- `name` (string, optional): Name inside the file, for a routeId
- `file` (string, optional): Destination path; default exports/ in the project

#### `refreshRide`

_writes · not destructive · idempotent · uses online services_

Recompute a saved ride without changing it: route the same waypoints again with the ride's own motorway setting, update distance, times, road mix and leg names, then re-gather daylight, weather, fixed cameras and stops, and rebuild the stop plan from the current bike profile. Deterministic, no planning involved; takes a minute or two. Use it when the rider says refresh, update or recompute a ride; with stopsOnly when only the stops or the bike profile changed. Returns the refreshed view, or the new stop plan.

- `ride` (string): Roadbook number or name
- `stopsOnly` (boolean, optional): Only rebuild the stop plan from the current bike profile; instant when the stops are cached

#### `rideBriefing`

_read-only · uses online services_

Ride-day briefing for a saved ride: forecast along the route now, daylight and return time, traffic at departure, the stops re-planned and checked against opening hours at arrival, fixed cameras, and a go, caution or no-go verdict with reasons. Deterministic; show it as returned. Without a ride, takes the next dated ride.

- `ride` (string, optional): Roadbook number or name; default the next planned ride
- `date` (string, optional): Day of the ride to brief, with ride: YYYY-MM-DD, today, saturday; default its next planned ride

#### `planRide`

_writes · not destructive · idempotent · uses online services_

Plan a ride from a saved roadbook on a date, without copying it: "plan a ride from roadbook 7 on Saturday at 9", or "plan a ride on Saturday" right after roadbook 7 was shown or discussed. Adds a ride to the roadbook (or updates the one already on that date), gathers the day: forecast along the loop, daylight, crosswind and low sun, the stop plan with opening hours at arrival, traffic at departure; returns the briefing with a go, caution or no-go verdict and the navigation links. Deterministic; show it as returned. Not for changing the route: a change ("50 km longer", "skip Tournai") goes through planningGuide with the roadbook.

- `roadbook` (string): Roadbook number or name
- `date` (string): Day of the ride: YYYY-MM-DD, or in words: today, tomorrow, saturday, 17/10
- `departure` (string, optional): Departure time, e.g. 09:00; default the roadbook's last departure

#### `deleteRoadbook`

_writes · may overwrite · idempotent · local only_

Delete a saved roadbook with its rides and notes, after the rider confirms (a dialog, or a question in the chat). Road ratings stay: they are about the roads. Only when the rider asks to delete it.

- `roadbook` (string): Roadbook number or name
- `confirm` (boolean, optional): Only after the rider said yes to the question a first call returned, in clients without dialogs

#### `deleteRide`

_writes · may overwrite · idempotent · local only_

Delete one ride (a roadbook on a day), after the rider confirms. The roadbook and the ride's notes stay. To keep the ride but mark it called off, use cancelRide instead.

- `roadbook` (string): Roadbook number or name
- `date` (string): Day of the ride: YYYY-MM-DD, 10/10, today, or a weekday
- `confirm` (boolean, optional): Only after the rider said yes to the question a first call returned, in clients without dialogs

#### `restoreRoadbook`

_writes · not destructive · not idempotent · local only_

Bring back an earlier version of a roadbook, listed under Versions in showRide. The current design is kept as a version too, so nothing is lost. For "undo that change" or "go back to the original".

- `roadbook` (string): Roadbook number or name
- `version` (integer): Version to bring back

#### `copyRoadbook`

_writes · not destructive · not idempotent · local only_

Make a separate roadbook with the same design, recorded as a variant of the original, to change on its own: "copy 7 as Avesnois short". Changes to a roadbook otherwise happen in place.

- `roadbook` (string): Roadbook number or name
- `name` (string, optional): Name of the copy

#### `cancelRide`

_writes · not destructive · idempotent · local only_

Cancel a planned ride (a roadbook on a day): it stays in the list, shown as cancelled. For "I'm not riding Saturday".

- `roadbook` (string): Roadbook number or name
- `date` (string): Day of the ride: YYYY-MM-DD, 10/10, today, or a weekday

#### `showRide`

_read-only · local only_

Full view of one saved ride, as the rider sees it in the app: figures, road mix, time at 70+, daylight, fixed cameras, fuel and café stops, legs with names, main roads, times and ratings, map link and the itinerary text. Show it to the rider as is; do not rebuild it from other tools.

- `ride` (string): Roadbook number or name

#### `showRideMap`

_read-only · local only_

A picture of a saved ride, to show the rider: the route leg by leg, towns in riding order, planned stops with their arrival times, fixed speed cameras with their limits, km marks, scale and the ride's figures. Drawn from the ride's own data, no map background. Returns the image; show it as is. exportMarkdown and rides map also write it to a file.

- `ride` (string): Roadbook number or name

#### `exportMarkdown`

_writes · may overwrite · idempotent · local only_

Write a saved ride as a Markdown document in the app's standard layout (figures, road mix, legs table, daylight, cameras, stops, itinerary), for versioning elsewhere. Returns the file path, and the document itself when asked.

- `ride` (string): Roadbook number or name
- `file` (string, optional): Destination path; default exports/ in the project
- `includeContent` (boolean, optional): Also return the Markdown text, default false

#### `addRideNote`

_writes · not destructive · not idempotent · local only_

During a ride: keep a note about the road just ridden, timed now, e.g. "last 10 min awesome" or "cobbles, never again". The note covers the minutes before it (default 10) and is placed on the road after the ride by reviewRide. Call it as soon as the rider says something about the road, with their words; no planning, no questions. Without a ride, it goes to the ride dated today, else the last saved one.

- `text` (string): The rider's words
- `rating` (integer, optional): Only if the rider gave one: 0 never again, 5 loved
- `minutesBack` (integer, optional): Minutes the note covers, default 10
- `ride` (string, optional): Roadbook number or name; default today's ride

#### `reviewRide`

_writes · not destructive · not idempotent · uses online services_

After a ride: place its pending notes on the road. With gpxPath (a track recorded by any app, as a GPX file on this machine), each note lands on the road actually ridden, detours of 2 km or more from the plan are listed, and the moving pace is compared with the plan; without it, notes are placed on the plan by elapsed time (approximate). Returns the stretches with a proposed rating each. Show the review as returned and ask the rider to confirm or change the ratings; then call again with decisions to store them. Stored road ratings steer future planning (0-1 avoided, 4-5 preferred).

- `ride` (string, optional): Roadbook number or name; default the ride of the latest pending note
- `gpxPath` (string, optional): Path of the recorded track on this machine
- `decisions` (object[], optional): The rider's confirmed ratings, after a first call without decisions

#### `rateRide`

_writes · not destructive · idempotent · local only_

Rate a saved ride after riding it, or one of its legs: 0 (never again) to 5 (loved), with the rider's words as a note. Ratings steer later plans: rides and legs rated 4-5 are reused as building blocks, those rated 0-1 avoided. For a stretch of road within a leg, notes during the ride and reviewRide are more precise. Use the rider's own rating; ask when they gave none.

- `ride` (string): Roadbook number or name
- `rating` (integer): 0 never again, 5 loved
- `leg` (integer, optional): Leg number, to rate one leg instead of the whole ride
- `day` (string, optional): Day of a ride (YYYY-MM-DD, saturday), to rate how that day went (weather, traffic, company) rather than the roads; it never marks a road
- `note` (string, optional): The rider's words, kept with the rating

#### `listRoadbooks`

_read-only · local only_

The rider's roadbooks (saved loops and trips), newest first, 20 per page: number, name, distance, time, how many rides and the next planned date, rating. The last line says the page and how to get the next one: call again with that page when the rider asks for more. The number is what the rider calls "ride 7".

- `page` (integer, optional): Page to show, 20 lines each (default 1)

#### `listRides`

_read-only · local only_

The rider's rides (a roadbook on a day), latest date first, rides with no date yet last, 20 per page: date, weekday, departure, roadbook number and name, distance, time, status (planned, ridden, cancelled). The last line says the page and how to get the next one: call again with that page when the rider asks for more. Use the roadbook number with showRide and the other ride tools.

- `page` (integer, optional): Page to show, 20 lines each (default 1)

#### `planningGuide`

_read-only · local only_

The full planning guidance for a new ride (how to search, what to check, how to lay out the itinerary), with the rider's request and current settings. Call it first whenever the rider asks for a new ride in plain words, whatever the client; then follow it. Not needed after the plan-ride command, which carries the same text. With a saved ride id, returns the guidance for editing that ride instead.

- `request` (string): What the rider asked for, verbatim
- `ride` (string, optional): Roadbook number or name, when the request is about an existing ride

### Prompts

Slash commands in Claude Code (`/mcp__ride__<name>`); plain words do the same in any client.

| Prompt           | Arguments                                | Does                                                                                                      |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `plan-ride`      | `request`                                | Plan a one-day ride with the agentMotoride tools: what the rider wants, in one sentence.                  |
| `commute`        | `destination`, `when`, `from` (optional) | Point to point, quickest sensible route, motorways permitted, with weather and traffic for the departure. |
| `edit-ride`      | `ride`, `change`                         | Load a saved ride and apply a change: new date, longer, skip a town, or just a question about it.         |
| `save-ride`      | `name` (optional)                        | Store the itinerary on the table in the library, under a name.                                            |
| `export-gpx`     | `ride` (optional)                        | GPX file of the current itinerary or of a saved ride, for a GPS app.                                      |
| `show-ride`      | `ride`                                   | Everything stored about one ride: figures, daylight, cameras, stops, legs, itinerary.                     |
| `export-md`      | `ride`, `file` (optional)                | The ride's standard Markdown document, written to a file and shown.                                       |
| `today`          | `ride` (optional)                        | Weather now, daylight, traffic, stops checked against opening hours, go or no-go for a saved ride.        |
| `refresh`        | `ride`                                   | Recompute a ride's figures, weather, cameras, stops and stop plan, without changing the ride.             |
| `note`           | `text`                                   | During the ride: "last 10 min awesome", "cobbles, never again". Reviewed after the ride.                  |
| `review`         | `gpxPath` (optional), `ride` (optional)  | Place your ride notes on the road ridden (recorded GPX track) or on the plan, then confirm ratings.       |
| `list-rides`     | `page` (optional)                        | The rider's rides by date, latest first, 20 per page.                                                     |
| `plan-from`      | `roadbook`, `day`, `time` (optional)     | A ride from a saved roadbook on a day, without copying it: forecast, stops, verdict, links.               |
| `list-roadbooks` | `page` (optional)                        | The rider's saved loops and trips, newest first, 20 per page.                                             |
| `help`           | none                                     | Commands and tools of agentMotoride, no tool call.                                                        |

### Resources

| Resource             | About                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| `ride://library`     | The rider's library, one line per ride                                      |
| `ride://roads/rated` | Rides, legs and road stretches the rider rated: 0-1 avoided, 4-5 sought out |
| `ride://ride/{id}`   | Everything stored about one saved ride                                      |

## Settings (`.env`)

| Setting                | Default             | What for                                                                                                                                                                                      |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`    | to set              | Anthropic API key (https://platform.claude.com/): the terminal app, and scouts in Claude Code or Codex                                                                                        |
| `ANTHROPIC_AUTH_TOKEN` | unset               | Or a bearer token instead of the key, as the Anthropic SDK accepts (e.g. behind a gateway)                                                                                                    |
| `RIDE_HOME`            | to set              | Your start and end point: a town, a street or an address, or "lat,lon" (overridden by --from)                                                                                                 |
| `TOMTOM_API_KEY`       | to set              | Optional TomTom key (https://developer.tomtom.com/, free tier): traffic at departure                                                                                                          |
| `RIDE_ALLOW_MOTORWAYS` | `0`                 | 1 permits motorways by default (--allow-motorways, /motorways on\|off per session)                                                                                                            |
| `RIDE_MAX_30_PCT`      | `3`                 | Target max % of distance in zones of 30 km/h or less (--max-30-pct)                                                                                                                           |
| `RIDE_MAX_50_PCT`      | `20`                | Target max % of distance in 31-50 km/h zones (--max-50-pct)                                                                                                                                   |
| `RIDE_DB`              | unset               | Saved rides and lookup cache, one SQLite file; default data/agentmotoride.db in the project                                                                                                   |
| `RIDE_SHARE_PORT`      | `8787`              | Port of the phone share page (/share, rides share)                                                                                                                                            |
| `RIDE_MODEL`           | `claude-opus-5-5`   | Model of the terminal app's planner; cheaper: claude-sonnet-5-5 (half price), claude-haiku-4-5 (quarter)                                                                                      |
| `RIDE_EFFORT`          | `high`              | Reasoning effort of the planner: low \| medium \| high \| xhigh \| max (ignored by Haiku)                                                                                                     |
| `RIDE_SCOUTS`          | `1`                 | Scouts explore candidate areas in parallel for a new ride; 0 turns them off (they bill ANTHROPIC_API_KEY, also under Claude Code or Codex; with 0, Claude Code scouts with its own subagents) |
| `RIDE_SCOUT_MODEL`     | `claude-sonnet-5-5` | Model of each scout                                                                                                                                                                           |
| `RIDE_SCOUT_EFFORT`    | `low`               | Reasoning effort of each scout                                                                                                                                                                |
