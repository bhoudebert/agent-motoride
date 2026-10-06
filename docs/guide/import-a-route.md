# Import a route someone shared

A club's Sunday ride, a friend's Kurviger or Calimoto export, a GPX from a
forum: import the file and it becomes a roadbook of your library like one you
planned, with its riding time, open-road share, slow zones, surfaces, legs
named by town, daylight, cameras and stops.

## Import

::: code-group

```bash [Terminal]
npm run rides -- import ~/Downloads/club-ride.gpx            # name from the file
npm run rides -- import ~/Downloads/route.kml "Ardennes with Marc"
```

```text [Claude Code / Codex]
import ~/Downloads/club-ride.gpx

then, as with any plan: "same but skip Givet", "save it"
```

:::

GPX tracks, GPX routes and KML lines are read, up to 10 MB. The file has to be
on the machine that runs the app.

## What comes back

```text
Club ride: imported from club-ride.gpx, 167.4 km in the file.
Routed 165.8 km, 2h54 riding, 99% of the file's line followed (3 routing passes, 8 waypoints).
1. Route Nationale near ... -> Route d'Haveluy near Denain: 28 km, 0h30
...
Saved as #8. See it with: npm run rides -- show 8
```

The **fidelity** says how much of the file's line the imported ride follows.

## How it follows the file

The file's line is reduced to a few waypoints and routed like a planned ride,
which is what gives it all the figures. Each leg is then compared with the
stretch of the file it replaces. Where the router took another road, a
waypoint is added in the middle of that stretch and the route is computed
again, up to three times.

::: tip The terminal import needs no model
`rides import` costs nothing and works without an API key. In Claude Code or Codex the
same import is a tool, so the planner can present it, change it and save it.
:::

## Good to know

- **Your rules still apply.** With motorways forbidden, a motorway in the file
  is routed around, and the fidelity drops to show it.
- **A repeat is refused**, like any save: importing a ride you already have
  says so. Add `--force` to keep a copy anyway.
- **Below 90%**, the import names the legs that leave the file's roads, often a
  closed road or a private track the router will not take.
