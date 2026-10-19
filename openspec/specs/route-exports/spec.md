# Route Exports Specification

## Purpose

Hand a planned ride to the phone and to navigation apps without losing the
chosen roads or the stops.

## Requirements

### Requirement: Navigation links

Google Maps links SHALL include pass-through points taken from the exact route line at the places farthest from the straight line between stops, within about ten points per link; a long ride SHALL be split into parts sharing a boundary point, preferably a planned stop, else a leg end; a tiny tail link SHALL be avoided by dropping the least useful points; a ride over 120 km with a stop near its middle SHALL get two parts. The view and the Markdown SHALL say where each part ends.

### Requirement: Whole-ride overview link

When a ride needs several navigation links, an overview link SHALL also be given: one Google Maps link through at most ten points spread over the whole ride (start, end, and the waypoints or pass-through points that keep its shape), labelled as a view of the whole ride, not for navigation. It SHALL appear wherever the parts do: the routing and stop-plan tool results, the itinerary, the roadbook view, the Markdown export and the phone share page.

#### Scenario: Loop far from home

- **WHEN** a ride from home to a distant loop and back needs three navigation parts
- **THEN** the output lists the three parts and one overview link showing the whole ride

### Requirement: GPX

The GPX SHALL hold a track (exact line, one segment per leg), a route (loop stops, planned stops as named stages, pass-through points, 40 by default, `--pins N` to cap) and waypoints (stops and planned stops with their time). Rides saved before the route line was stored SHALL be re-routed on first export and the line kept.

### Requirement: Roadbook file

Exporting a saved ride SHALL also write a roadbook file next to the GPX, same name with `.motoride.json`, for the MobileMotoRide app, as specified in `docs/roadbook-file.md`: the route line, the stops, the speed limit of each stretch and the fixed cameras. The line SHALL be the one Valhalla traced for each leg, all legs joined with the shared point written once, so that each stretch, given as point indexes from and to into that line, refers to points that are written. A stretch SHALL carry the limit that applies, the posted one from OpenStreetMap or else the legal default of the country and region, or 50 at most in a built-up area (the same rule as the road statistics), whether it was posted, and the road ref or name; edges of one road under one limit SHALL make one stretch. Stops SHALL be in riding order, the loop's own and the planned ones placed by their kilometre, each marked `waypoint` (a point of the loop: start, via points, finish, which the app lets the rider skip) or `stop` (a planned fuel, café or pause stop on the route, which it does not). Cameras SHALL carry their place and limit, a `bearing` (degrees clockwise from north, the way the camera faces) when OpenStreetMap gives its direction as degrees or a compass point, and a direction only when it is `both`; `forward` and `backward` SHALL NOT be exported, because they are relative to the OpenStreetMap way and not to the route, and several values at once SHALL give no bearing. The file SHALL also list the roundabouts the line goes through as `junctions`: for each, the line indexes where the rider enters and leaves the ring, the roads that can be driven out of the ring as bearings in degrees relative to the way the rider enters (a one-way road that only leads in SHALL NOT count), the index of the exit taken, and `traffic: "left"` where traffic keeps left. A roundabout the leg starts or ends in, or with fewer than two exits, SHALL be left out. When a leg cannot be traced the file SHALL still be written with that leg's routed line and no limits for it, and the export SHALL say which leg lacked limits and why. The file SHALL be reported wherever the GPX is: `rides export`, `/gpx`, the library menu and the `exportGpx` tool.

#### Scenario: A route goes through a roundabout

- **WHEN** a traced leg enters a ring from a road heading north, with roads leaving it at 100° and 10° and the line leaving at 10°
- **THEN** the file lists a roundabout with exits relative to the way in, the taken one marked by its index, and the indexes of its entry and exit points on the written line

#### Scenario: Valhalla answers 429 for one leg

- **WHEN** the second leg of a three-leg ride cannot be traced
- **THEN** the roadbook file is written with the first and third legs' limits, the second leg's line and no limits, and the output names leg 2 and the error

### Requirement: Markdown

A ride SHALL export as a Markdown document in a fixed layout: headline figures, date and start, request, navigation links, figures, road mix with 70 km/h readings, legs table, daylight, weather table, stop plan table with locations, fixed cameras (one row per spot, doubled entries marked), fuel and café stops, planning metadata, itinerary text as planned, waypoints. Available from the CLI, the prompt and MCP.

### Requirement: Ride map

A roadbook SHALL be drawable as a picture from its own data, without map tiles or network: the route leg by leg, the towns at the leg ends in riding order (never coordinates or country names), planned stops with their arrival times, fixed cameras with their posted limits, km marks every 25 km (left out where they would sit on a marker or on the same road ridden back), a scale bar, north, the ride's figures and the OpenStreetMap attribution. It SHALL be a PNG rendered with bundled fonts only, the same on every machine, available as `rides map`, `/map`, the `showRideMap` MCP tool (returning the image), next to the Markdown export (shown at its top) and on the phone share page.

#### Scenario: Cameras on a motorway hop

- **WHEN** a ride has fixed cameras at 130 on its way to the riding area
- **THEN** the map shows each camera as a badge reading 130 at its place on the route

### Requirement: Phone handoff

`/qr` SHALL print a QR code of the first navigation link. `/share` SHALL serve a page on the local network with one button per link part, the itinerary and a GPX download, print its QR code, follow the current itinerary while the session runs, and stop on quit.
