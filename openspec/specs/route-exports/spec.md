# Route Exports Specification

## Purpose

Hand a planned ride to the phone and to navigation apps without losing the
chosen roads or the stops.

## Requirements

### Requirement: Navigation links

Google Maps links SHALL include pass-through points taken from the exact route line at the places farthest from the straight line between stops, within about ten points per link; a long ride SHALL be split into parts sharing a boundary point, preferably a planned stop, else a leg end; a tiny tail link SHALL be avoided by dropping the least useful points; a ride over 120 km with a stop near its middle SHALL get two parts. The view and the Markdown SHALL say where each part ends.

### Requirement: Whole-ride overview link

When a ride needs several navigation links, an overview link SHALL also be given: one Google Maps link through at most ten points spread over the whole ride (start, end, and the waypoints or pass-through points that keep its shape), labelled as a view of the whole ride, not for navigation. It SHALL appear wherever the parts do: the routing and stop-plan tool results, the itinerary, the saved ride view, the Markdown export and the phone share page.

#### Scenario: Loop far from home

- **WHEN** a ride from home to a distant loop and back needs three navigation parts
- **THEN** the output lists the three parts and one overview link showing the whole ride

### Requirement: GPX

The GPX SHALL hold a track (exact line, one segment per leg), a route (loop stops, planned stops as named stages, pass-through points, 40 by default, `--pins N` to cap) and waypoints (stops and planned stops with their time). Rides saved before the route line was stored SHALL be re-routed on first export and the line kept.

### Requirement: Markdown

A ride SHALL export as a Markdown document in a fixed layout: headline figures, date and start, request, navigation links, figures, road mix with 70 km/h readings, legs table, daylight, weather table, stop plan table with locations, fixed cameras (one row per spot, doubled entries marked), fuel and café stops, planning metadata, itinerary text as planned, waypoints. Available from the CLI, the prompt and MCP.

### Requirement: Ride map

A saved ride SHALL be drawable as a picture from its own data, without map tiles or network: the route leg by leg, the towns at the leg ends in riding order (never coordinates or country names), planned stops with their arrival times, fixed cameras with their posted limits, km marks every 25 km (left out where they would sit on a marker or on the same road ridden back), a scale bar, north, the ride's figures and the OpenStreetMap attribution. It SHALL be a PNG rendered with bundled fonts only, the same on every machine, available as `rides map`, `/map`, the `showRideMap` MCP tool (returning the image), next to the Markdown export (shown at its top) and on the phone share page.

#### Scenario: Cameras on a motorway hop

- **WHEN** a ride has fixed cameras at 130 on its way to the riding area
- **THEN** the map shows each camera as a badge reading 130 at its place on the route

### Requirement: Phone handoff

`/qr` SHALL print a QR code of the first navigation link. `/share` SHALL serve a page on the local network with one button per link part, the itinerary and a GPX download, print its QR code, follow the current itinerary while the session runs, and stop on quit.
