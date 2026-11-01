# On the phone and the GPS

A plan is only useful on the bike. Every ride comes with Google Maps links that
stay on the chosen roads, a GPX file for navigation apps and GPS units, and a
page for the phone.

## Google Maps links

Every itinerary ends with its navigation links. A link through the waypoints
alone lets Google take its own fastest path and drift off your D-road; these
links add pass-through points taken from the exact route, where Google would
otherwise cut away. Google takes about ten points per link, so a long ride
comes in parts:

```text
Map part 1/2: https://www.google.com/maps/dir/...
Map part 2/2: https://www.google.com/maps/dir/...
  part 1 ends at km 103, pause: Les Secrets du sucré: open part 2 there
Whole ride (overview, not for navigation): https://www.google.com/maps/dir/...
```

- **Switch parts at the planned stop**: the split is placed there when one is
  in reach, so you change links while already stopped.
- **The whole-ride overview** shows everything in one map, handy for a loop far
  from home with the way there and back. Navigate with the parts: between the
  overview's points, Google may pick other roads.

## A map of the ride

A picture of the whole ride, roadbook style: the route leg by leg, the towns in
riding order, the planned stops with their arrival times, the fixed cameras with
their speed limit, km marks, a scale and the ride's figures.

::: code-group

```bash [Terminal]
npm run rides -- map 7                  # writes exports/7-<name>.png
npm run rides -- map 7 ~/ride-map.png   # or a path you choose

# at the refine> prompt, on a saved roadbook: /map
```

```text [Claude Code / Codex]
show me roadbook 7 on a map

(the picture shows in the chat)
```

:::

![Map of a 131.5 km loop from Namur through the Condroz, with its towns, a coffee stop and six fixed speed cameras with their limits](/ride-map.png)

_A real plan from Namur. Regenerate this example with `node scripts/sample-map.ts`._

It is drawn from the ride's own data, with no map background, so it works
offline and looks the same everywhere. It also comes with the Markdown export
(at the top of the document) and on the phone share page. For streets and
the land around, use the Google Maps links.

## For the MobileMotoRide app

The app works without a server; what a server adds is on [With or without a server](/with-or-without-a-server).

Exporting a saved ride also writes a **roadbook file** next to the GPX, `<name>.motoride.json`, for the
MobileMotoRide app: the exact line, the stops, the speed limit of
every stretch (posted, or assumed from the country default and marked so) and the fixed cameras. The app shows the
limit at all times and warns when you are over it. The export says where the file went, and if Valhalla could not
give the limits for a leg, which one.

```bash
npm run rides -- export 7    # 7-<name>.gpx and 7-<name>.motoride.json in exports/
```

The format is described in `docs/roadbook-file.md`.

## In the MotoRide app: gauges

The MotoRide app (test builds on Android and iOS) shows a few readings at the left of the map during a ride, each with
its own switch in a **Gauges** card:

- **Compass**, **altitude and climb**, and **slope** over the last 150 m, from the GPS.
- **Lean angle** with your peak to the left and to the right, the **lateral G**, and the **braking G**, from the phone's
  own accelerometer and gyroscope. Put the phone on its mount with the screen towards you, stand the bike upright and tap
  Calibrate once; no sensor is needed on the bike.

The lean is worked out from the turning rate and the GPS speed, because a phone used as a level meter reads about zero in
a steady corner (the bike leans exactly along the force it feels). It is indicative: expect a few degrees of error, more in
quick changes of direction, and nothing under 18 km/h. Lean and braking are off until the phone is calibrated.

## In the MotoRide app: on the road

Beyond the gauges, the app helps during a ride, each with its own switch where it matters:

- **Fuel stops.** The fuel stations along the roadbook (from OpenStreetMap) are on the map with the distance to the next one,
  and the app says so once when the stretch after a station is longer than 60 % of your tank range, which you set on the card.
- **Find along the route.** A bakery, café, restaurant, viewpoint, toilets, cash machine or motorcycle shop in the next 60 km,
  listed with how far off the route it is. Pick one and it is marked on the map: the roadbook stays your route and the app
  guides you back after the detour.
- **Weather ahead.** The forecast for where you are and every 15 km ahead, at the time you will be there (MET Norway): dry, rain in
  30 km, rain on a cold road (ice risk). It says it once before bad weather and can be turned off.
- **Crash and fall detection.** A hard shock followed by ten seconds without moving, with the phone no longer upright, asks if you
  are all right for 30 seconds. If you do not answer, a **live ride** (below) shows a red "Possible crash" with your position to
  anyone who has its page open (nothing is pushed to them), and a message for your emergency contact and a call to 112 are one tap
  away on the screen for whoever holds the phone. The app calls and texts no one by itself, and it can miss a crash or raise a false
  alert: it is an aid, not a guarantee.
- **Traffic ahead** (needs your server). The next 60 km coloured orange or red where the traffic is slow, from points every
  10 km, and a line such as "Slow in 12 km". It only informs you: your roadbook never changes, and you decide whether to use Skip
  or take another road. By default the server reads **open government data** (France today, the main measured roads), with no key
  and no cost; elsewhere a point shows no traffic. A host can choose **TomTom** instead with their own key
  (`TRAFFIC_PROVIDER=tomtom-flow`, `TOMTOM_API_KEY`, a daily cap `TRAFFIC_MAX_PER_DAY`, 600 by default), see
  [Self-hosting](/self-hosting). The phone holds no key and talks to no traffic service. The points are sent to your server, which
  therefore learns about where you ride: use a server you trust.
- **Looking back.** From "My rides", open a recorded ride for its track coloured by speed, its figures and a replay.
- **The phone's look and language.** Light or dark, English or French, following the phone or chosen in the menu. The voice lowers
  the music while it speaks.

## To the phone

::: code-group

```bash [Terminal]
npm run rides -- share 7    # a page on your Wi-Fi, with its QR code, until Ctrl-C
npm run rides -- qr 7       # just the QR code of the map link

# at the refine> prompt: /share or /qr
```

```text [Claude Code / Codex]
show roadbook 7

(from the phone with Remote Control, the links in the answer open directly)
```

:::

The share page has every map part, the whole-ride overview, the itinerary, a
GPX download and, for a saved ride, the roadbook file for the MotoRide app: an
"Open in MotoRide" button (and a second QR code in the terminal) that makes the
app download and import it. Phone and computer must be on the same Wi-Fi; some
routers isolate devices on guest networks, and then the phone cannot reach the
computer. Any other way of getting the one `.motoride.json` file to the phone
(share sheet, AirDrop, e-mail, cable) works with the app's import button. It stays on your local network; nothing is put online.

### From your server

With the phone enrolled on your server (the invitation QR, see [Run it for several riders](/several-riders)), the
roadbooks of the library on that server can be fetched by the app itself: `GET /roadbooks` lists them with a version
stamp and `GET /roadbook/<id>` gives the file. Nothing to export or carry. This needs a server; without one, use the
share page or any way of moving the one `.motoride.json` file. Each roadbook is listed with where it stands: _current_, _outdated_ (its route, stops or cameras changed, or you rebuilt
your server's map, [Keep the map current](/self-hosting)), _refreshing_ or _failed_. An outdated one still works with the
file the phone has. The refresh is made on the server, in the background: tap it on the phone (or let the server do it by
itself for a ride dated in the next two weeks), the phone shows "under refresh", and when the state is _current_ the update
downloads at once, with the speed limits of the new map. `refresh` a ride on the server to bring new cameras in.

If you plan on a library that is not on the server (your own computer), push the roadbook file there. Put the server's
address and your rider token in `.env` (`RIDE_REMOTE_URL`, `RIDE_REMOTE_TOKEN`, the token from `npm run admin -- add`):

::: code-group

```bash [Terminal]
npm run rides -- export 7 --push
```

```text [Claude Code / Codex]
export roadbook 7 as GPX and push it to my server
```

:::

A push is quick, a few seconds: your computer sends the route, the waypoints and the cameras and writes the GPX, and nothing
else. It does not trace the speed limits, look up built-up land or ask for road signs: the server does that itself, on its own
map, when the phone downloads the roadbook. (An export without `--push` still makes the full roadbook file with the limits, for
the share page or a file you carry, and that is the slow one.)

The roadbook is added to your library on the server, like one planned there, and the phone lists it with the download and refresh icons.
Pushing the same roadbook again replaces the earlier copy; if nothing changed, the phone sees no new version.

## For the GPS

::: code-group

```bash [Terminal]
npm run rides -- export 7                 # writes exports/7-<name>.gpx
npm run rides -- export 7 ~/ride.gpx      # or a path you choose

# at the refine> prompt: /gpx
```

```text [Claude Code / Codex]
export roadbook 7 as GPX
```

:::

The file holds the ride three ways, so every app finds what it reads: the
exact **track**, a **route** with the stops and pass-through points (for apps
that compute their own path, like Liberty Rider, Garmin and TomTom), and the
planned stops as named **waypoints** with their times.

`--pins 15` exports fewer route points: a shorter stage list in the app, a
little more drift between them.

::: tip Liberty Rider
Liberty Rider shows route points as numbered stages without names. The ride
view tells you which number each planned stop is ("pause: ... route point 22
of 40") and where it is in words.
:::

## The morning of the ride

::: code-group

```bash [Terminal]
npm run rides -- today                 # the next planned ride, any roadbook
npm run rides -- today 7               # roadbook 7's next ride
npm run rides -- today 7 saturday      # roadbook 7's ride on Saturday
```

```text [Claude Code / Codex]
briefing for roadbook 7
briefing for Saturday's ride of roadbook 7

(or: "can I ride the Avesnois loop today?")
```

:::

The briefing checks again what can change since planning: the forecast now
along the route, daylight and the return time, traffic at departure, each stop
against its opening hours at arrival, crosswind and low sun. It ends with
**GO**, **GO with caution** or **NO-GO as planned**, and the reasons.

## Good to know

- Waze and Google Maps cannot import GPX: use the links for Google, and an
  alert app in the background for speed-camera warnings.
- When a GPS app shows a route different from the file, it is recalculating
  from the route points; choose "follow the track" in that app.

## A ride recorded by the MotoRide app

The MotoRide app saves every ride it guides as a GPX, finished or not, and shares it from "My rides". Hand that file to
`review` like any recorded track:

```bash
npm run rides -- review ~/Downloads/2026-10-19T09-30-05-pays-des-collines-loop.gpx
```

The file also has the altitude of every point and, when the rider had lean on, the lean, the lateral and braking G and the
turning rate of each point (in `motoride:` extensions that other programs ignore), with the climb and the peak leans in its
metadata. `review` reads the track and ignores them.

The track says which roadbook it followed, so you do not have to name it. The numbers are those of your own library, and
they repeat from one library to another, so the match needs the number **and** the name: a track whose roadbook 7 is
"Eifel loop" will not be taken for your roadbook 7 "Pays des Collines", it is refused and you name the roadbook yourself.

### Keeping a recorded ride on your server

With the MotoRide app connected to your server, a recorded ride can be uploaded to your library, from the end of the ride or later from
"My rides". It is yours alone: the server keeps the GPX in your library, lists it, gives it back, and you can delete it there. Deleting it
on the phone does not delete it on the server, nor the other way round. A ride you never uploaded exists only on the phone, so deleting
it there loses it for good. A ride with no roadbook (you rode without a plan) is kept too. The details for app makers are in
`docs/roadbook-file.md`, section "Uploading a recorded ride".
