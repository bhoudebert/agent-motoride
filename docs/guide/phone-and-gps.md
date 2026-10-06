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

## To the phone

::: code-group

```bash [Terminal]
npm run rides -- share 7    # a page on your Wi-Fi, with its QR code, until Ctrl-C
npm run rides -- qr 7       # just the QR code of the map link

# at the refine> prompt: /share or /qr
```

```text [Claude Code / Codex]
show ride 7

(from the phone with Remote Control, the links in the answer open directly)
```

:::

The share page has every map part, the whole-ride overview, the itinerary and
a GPX download. It stays on your local network; nothing is put online.

## For the GPS

::: code-group

```bash [Terminal]
npm run rides -- export 7                 # writes exports/7-<name>.gpx
npm run rides -- export 7 ~/ride.gpx      # or a path you choose

# at the refine> prompt: /gpx
```

```text [Claude Code / Codex]
export ride 7 as GPX
```

:::

The file holds the ride three ways, so every app finds what it reads: the
exact **track**, a **route** with the stops and pass-through points (for apps
that compute their own path, like Liberty Rider, Garmin and TomTom), and the
planned stops as named **waypoints** with their times.

::: tip Liberty Rider
Liberty Rider shows route points as numbered stages without names. The ride
view tells you which number each planned stop is ("pause: ... route point 22
of 40") and where it is in words.
:::

## The morning of the ride

::: code-group

```bash [Terminal]
npm run rides -- today       # the next dated ride
npm run rides -- today 7
```

```text [Claude Code / Codex]
briefing for ride 7

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
