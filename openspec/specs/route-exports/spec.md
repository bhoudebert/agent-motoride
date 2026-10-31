# Route Exports Specification

## Purpose

Hand a planned ride to the phone and to navigation apps without losing the
chosen roads or the stops.

## Requirements

### Requirement: Navigation links

Google Maps links SHALL include pass-through points taken from the exact route line at the places farthest from the straight line between stops, within about ten points per link; a long ride SHALL be split into parts sharing a boundary point, preferably a planned stop, else a leg end; a tiny tail link SHALL be avoided by dropping the least useful points; a ride over 120 km with a stop near its middle SHALL get two parts. The view and the Markdown SHALL say where each part ends.

#### Scenario: Long loop with a pause near its middle

- **WHEN** a loop of more than 120 km would fit in one link and has a planned pause between a third and two thirds of the way
- **THEN** it gets two links of at most ten points each, the first ending at the pause and the second starting from it

### Requirement: Whole-ride overview link

When a ride needs several navigation links, an overview link SHALL also be given: one Google Maps link through at most ten points spread over the whole ride (start, end, and the waypoints or pass-through points that keep its shape), labelled as a view of the whole ride, not for navigation. It SHALL appear wherever the parts do: the routing and stop-plan tool results, the itinerary, the roadbook view, the Markdown export and the phone share page.

#### Scenario: Loop far from home

- **WHEN** a ride from home to a distant loop and back needs three navigation parts
- **THEN** the output lists the three parts and one overview link showing the whole ride

### Requirement: GPX

The GPX SHALL hold a track (exact line, one segment per leg), a route (loop stops, planned stops as named stages, pass-through points, 40 by default, `--pins N` to cap) and waypoints (stops and planned stops with their time). Rides saved before the route line was stored SHALL be re-routed on first export and the line kept.

#### Scenario: Three legs and a café pause

- **WHEN** a three-leg ride with a pause at "Café" at 10:05 is exported
- **THEN** the GPX holds three track segments, a route with pass-through points between the stops and the stage "pause: Café (10:05)", and a waypoint for the café

### Requirement: Roadbook file

Exporting a saved ride SHALL also write a roadbook file next to the GPX, same name with `.motoride.json`, for the MobileMotoRide app, as specified in `docs/roadbook-file.md`: the route line, the stops, the speed limit of each stretch and the fixed cameras. The line SHALL be the one Valhalla traced for each leg, all legs joined with the shared point written once, so that each stretch, given as point indexes from and to into that line, refers to points that are written. A stretch SHALL carry the limit that applies, the posted one from OpenStreetMap or else the legal default of the country and region, or 50 at most in a built-up area (the same rule as the road statistics), whether it was posted, and the road ref or name; edges of one road under one limit SHALL make one stretch. An edge with no posted limit and a default above 50, of which at least half lies in OpenStreetMap land use residential, commercial, retail or industrial, SHALL be given 50, stay `posted: false` and carry `source: "inferred"`; a posted limit SHALL never be changed by land use; when the land use cannot be fetched the defaults SHALL stand and the export SHALL say that built-up areas were not checked. When a Mapillary token is configured, a speed limit sign seen in street-level photos SHALL set the limit of the stretch it stands beside, including over a posted OpenStreetMap limit, marked `posted: true` and `source: "sign"`, but only when the sign lies within 12 m of the line and faces along the road (either way, within 35° of its axis), was last seen within two years, has no road works marker (warning roadworks, end of road works) within 40 m, and does not disagree with another such sign on the same stretch; a roundabout's ring SHALL take no sign; a sign SHALL come before the built-up inference; without a token nothing SHALL change; when the sign service fails the other limits SHALL stand and the export SHALL say that road signs were not checked; and the export SHALL list each stretch where a sign overrode a posted limit, with both values. Stops SHALL be in riding order, the loop's own and the planned ones placed by their kilometre, each marked `waypoint` (a point of the loop: start, via points, finish, which the app lets the rider skip) or `stop` (a planned fuel, café or pause stop on the route, which it does not). Cameras SHALL carry their place and limit, a `bearing` (degrees clockwise from north, the way the camera faces) when OpenStreetMap gives its direction as degrees or a compass point, and a direction only when it is `both`; `forward` and `backward` SHALL NOT be exported, because they are relative to the OpenStreetMap way and not to the route, and several values at once SHALL give no bearing. The file SHALL also list the roundabouts the line goes through as `junctions`: for each, the line indexes where the rider enters and leaves the ring, the roads that can be driven out of the ring as bearings in degrees relative to the way the rider enters (a one-way road that only leads in SHALL NOT count), the index of the exit taken, and `traffic: "left"` where traffic keeps left. A roundabout the leg starts or ends in, or with fewer than two exits, SHALL be left out. The file SHALL give the country of each stretch of the line as `countries` (ISO code, from the country Valhalla reports for each edge, consecutive edges of one country making one stretch, indexes into the written line), since the rules on warning of a camera differ by country and the app applies them. A camera that lies in Germany or Switzerland, where such warnings are forbidden, SHALL NOT be written. The file SHALL say which roadbook it is with an `origin`: `app` "agentRide", the roadbook's number in this library, its ride (day) number when it has one, and its name; a reader SHALL NOT match on the number alone, since numbers repeat from one library to another. When a leg cannot be traced the file SHALL still be written with that leg's routed line and no limits for it, and the export SHALL say which leg lacked limits and why. The file SHALL be reported wherever the GPX is: `rides export`, `/gpx`, the library menu and the `exportGpx` tool.

#### Scenario: A route goes through a roundabout

- **WHEN** a traced leg enters a ring from a road heading north, with roads leaving it at 100° and 10° and the line leaving at 10°
- **THEN** the file lists a roundabout with exits relative to the way in, the taken one marked by its index, and the indexes of its entry and exit points on the written line

#### Scenario: A route crosses a border

- **WHEN** the line runs 40 points in France and then 80 in Belgium
- **THEN** the file lists a French stretch and a Belgian one with the indexes of those points, and a camera in a Germany stretch is left out

#### Scenario: An untagged road through a village

- **WHEN** an edge has no `maxspeed`, would get the French default of 80, and runs through residential land
- **THEN** its stretch has limit 50, `posted: false` and `source: "inferred"`, while an untagged edge in open country keeps 80

#### Scenario: A speed limit sign beside an untagged or wrongly tagged road

- **WHEN** a token is set and a 70 sign, last seen a month ago and facing along the road, stands 5 m from a stretch posted 90 in OpenStreetMap
- **THEN** the stretch has limit 70, `posted: true` and `source: "sign"`, and the export lists "sign says 70, OSM says 90"

#### Scenario: Signs that do not count

- **WHEN** a limit sign faces across the road, stands 15 m away, was last seen three years ago, or has a roadworks sign within 40 m
- **THEN** it sets no limit and the stretch keeps its OpenStreetMap or guessed limit

#### Scenario: Valhalla answers 429 for one leg

- **WHEN** the second leg of a three-leg ride cannot be traced
- **THEN** the roadbook file is written with the first and third legs' limits, the second leg's line and no limits, and the output names leg 2 and the error

### Requirement: Markdown

A ride SHALL export as a Markdown document in a fixed layout: headline figures, date and start, request, navigation links, figures, road mix with 70 km/h readings, legs table, daylight, weather table, stop plan table with locations, fixed cameras (one row per spot, doubled entries marked), fuel and café stops, planning metadata, itinerary text as planned, waypoints. Available from the CLI, the prompt and MCP.

#### Scenario: Two cameras at one spot

- **WHEN** a saved ride with two fixed cameras at 130 at km 4 is exported as Markdown
- **THEN** the document has the road mix, legs, daylight, weather, stop plan, fixed cameras, fuel stops and itinerary sections
- **AND** the two cameras make one row marked "4 (x2)"

### Requirement: Ride map

A roadbook SHALL be drawable as a picture from its own data, without map tiles or network: the route leg by leg, the towns at the leg ends in riding order (never coordinates or country names), planned stops with their arrival times, fixed cameras with their posted limits, km marks every 25 km (left out where they would sit on a marker or on the same road ridden back), a scale bar, north, the ride's figures and the OpenStreetMap attribution. It SHALL be a PNG rendered with bundled fonts only, the same on every machine, available as `rides map`, `/map`, the `showRideMap` MCP tool (returning the image), next to the Markdown export (shown at its top) and on the phone share page.

#### Scenario: Cameras on a motorway hop

- **WHEN** a ride has fixed cameras at 130 on its way to the riding area
- **THEN** the map shows each camera as a badge reading 130 at its place on the route

### Requirement: Roadbook file on the share page

The phone share page of a saved ride SHALL also serve the roadbook file at `/ride.motoride.json`, as a download, and offer an "Open in MotoRide" button on the link `mobilemotoride://import?url=<that file's address>` that makes the MobileMotoRide app download and import it. The file SHALL be made when first requested, once per share, because it traces the route; a failure SHALL answer 502 and not be kept, so the next request tries again. `rides share` and `/share` SHALL also print a second QR code of that import link. A ride without a saved library entry (an itinerary not yet saved) SHALL NOT offer the file, because its cameras are not known.

#### Scenario: The rider opens the share page on the phone

- **WHEN** the phone opens the share page of saved ride 7 and taps "Open in MotoRide"
- **THEN** the app downloads `/ride.motoride.json` and imports it, and a second request for the file does not trace the route again

#### Scenario: The route cannot be traced

- **WHEN** the router answers 429 while the file is made
- **THEN** the request answers 502, and the next request makes the file again

### Requirement: Phone handoff

`/qr` SHALL print a QR code of the first navigation link. `/share` SHALL serve a page on the local network with one button per link part, the itinerary and a GPX download, print its QR code, follow the current itinerary while the session runs, and stop on quit.

#### Scenario: A ride in two parts on the phone

- **WHEN** the rider types `/share` for a ride with two navigation parts
- **THEN** a page on the local network shows a button for each part, the itinerary and a GPX download, and its QR code is printed
- **AND** the page stops when the rider quits
