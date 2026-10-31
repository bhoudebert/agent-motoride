# The roadbook file (`motoride-roadbook`, version 1)

> This is a copy of the contract kept in the MobileMotoRide repository (`docs/roadbook-format.md`). The two repositories
> change it together, through the version number.

What agentRide hands to MobileMotoRide. One JSON file per roadbook, extension `.motoride.json`. A GPX stays
available for other apps; the app reads a GPX too, but without limits or cameras.

```json
{
  "format": "motoride-roadbook",
  "version": 1,
  "name": "Pays des Collines loop",
  "description": "122.3 km, about 2h05 riding.",
  "generatedAt": "2026-10-18T10:00:00.000Z",
  "line": "<encoded polyline, precision 6>",
  "stops": [{ "lat": 50.4552, "lon": 3.20384, "name": "Start", "kind": "waypoint" }],
  "limits": [{ "from": 0, "to": 183, "kmh": 50, "posted": true, "road": "D 954" }],
  "cameras": [{ "lat": 50.52, "lon": 3.31, "kmh": 70, "bearing": 90, "direction": null }],
  "junctions": [{ "kind": "roundabout", "at": 412, "to": 431, "exits": [-80, 15, 100], "take": 1 }],
  "countries": [
    { "from": 0, "to": 390, "code": "FR" },
    { "from": 390, "to": 900, "code": "BE" }
  ]
}
```

## Fields

- `format`, `version`: `"motoride-roadbook"` and `1`. A reader refuses another format and any version above the
  ones it knows; it ignores fields it does not know (so a version 1 file can gain optional fields).
- `line`: the route, all legs joined in riding order, as an encoded polyline of precision 6 (the Valhalla and
  agentRide encoding). At least two points.
- `stops`: named places in riding order. `kind` is `waypoint` (the loop's own points: start, via points, finish; the
  default) or `stop` (planned fuel, café or pause stops lying on the route). The app lets the rider skip waypoints,
  never stops. Optional.
- `limits`: the speed limit along the line. Each entry covers the stretch of the line from point `from` to point
  `to`, both **indexes into the decoded `line`** (`0 <= from < to <= last index`), so it needs no length measure.
  Consecutive stretches share their boundary point: the next `from` is the previous `to`. `kmh` is the limit that applies,
  `posted` tells a tagged limit (true) from an assumed one, the country or built-up default (false), `source` is
  `"inferred"` on an untagged road that lies in built-up land and was set to 50 from OpenStreetMap land use
  (ADR 0045), `"sign"` where a speed limit sign seen in street-level photos set the limit, over OpenStreetMap's
  too (`posted` is then true; ADR 0046), absent otherwise (a reader that does not know it ignores it), `road` is the
  road ref or name, optional. Entries are in order and should not overlap; a gap means unknown. Optional.
- `cameras`: fixed speed cameras near the line. `kmh` is the camera's limit or null. `bearing` is the direction the
  camera faces, degrees clockwise from north (0 to 359), when OpenStreetMap gives it as degrees or a compass point;
  the camera then watches traffic travelling the opposite way. `direction` is `both` or null: OpenStreetMap's
  `forward` and `backward` are relative to the way, not to the line, so they are not exported. Optional. The app shows them as danger zones, never as camera
  positions (`openspec/specs/danger-zones`).
- `junctions`: the roundabouts of the line, in order. `at` and `to` are indexes into `line` of the points where the rider
  enters and leaves the ring. `exits` are the roads that can be driven out of the ring, as bearings in degrees relative to
  the way the rider enters (0 straight ahead, 90 to the right, -90 to the left), from -180 to 180; `take` is the index in
  `exits` of the exit the line takes. `traffic` is `left` where traffic keeps left, absent otherwise. Read from the
  traced edges (Valhalla's `roundabout` flag and the roads meeting the ring). Lane guidance is not produced yet: the
  routing data has no turn lanes for the area it was tried on. Optional in the file, as the app reads it.
- `countries`: the country of each stretch of the line, as indexes into `line` like `limits`, with an ISO 3166-1 alpha-2
  `code`. The app decides from it what it may say about a camera: its place and distance, only a danger zone, or nothing.
  A roadbook without it gets no camera warning at all. Cameras in Germany and Switzerland are not written. Optional.
- `origin`: which roadbook of which library this is: `{ "app": "agentRide", "roadbook": 7, "ride": 12, "name": "Pays des
Collines loop" }`. The numbers are this library's own and repeat from one library to another, so a reader that matches
  a ride recorded on the phone back to a roadbook must find the number **and** the same name. The MotoRide app copies
  them into the GPX of a ride it records; `rides review track.gpx` reads them and refuses a number that means another
  roadbook. Optional.

## Rules for the producer

- `limits` indexes refer to the `line` as written. A producer that routes and traces separately must write the
  line it traced, so the indexes hold.
- Distances are never stored: the reader measures the line itself.
- Coordinates are WGS84 degrees. Strings are UTF-8.
- Data comes from OpenStreetMap: keep its attribution with the file's use.

## Fetching from a server

A phone enrolled on an agentRide server (the token it got from its invitation) can fetch roadbooks without any file
being exported:

- `GET /roadbooks` with `Authorization: Bearer <token>` gives `{"roadbooks": [{"id", "name", "distanceKm",
"ridingMinutes", "stamp", "state", "ready", "mapDay"?, "error"?, "errorCode"?}]}`, the rider's roadbooks. It answers at once and never
  waits for a file. `stamp` is the version of the file that is **ready to download now**; `state` says where the
  roadbook stands:
  - `current`: the ready file is made from the roadbook as it is and on the map in use;
  - `outdated`: the ready file is older (the roadbook changed, or the host rebuilt its Valhalla map), or there is
    none yet; the old file still works;
  - `refreshing`: the server is making a new file; poll the list;
  - `failed`: the last try failed (`error` says why, in one short sentence of 80 characters or less, in English, and
    `errorCode` names the reason so an app can translate it: `map_down`, `rate_limited`, `timeout` or `other`); the ready
    file is still served; a tap tries again.
    `mapDay` (UTC day, only on a host with its own Valhalla) is the map the ready file was made on. A refresh can end
    `current` on the **same** stamp (the roadbook itself did not change, and a stamp ignores the time the file was
    made, or the file listed before it existed already carried the stamp it got): a reader must not expect the stamp
    to move after a refresh. A reader that
    ignores `state` sees a stamp that only changes when a new file is ready, so it never offers an update early.
- `GET /roadbook/<id>` gives the file above, **at once**, even when it is outdated. Its `ETag` is the ready file's
  `stamp`; send it back in `If-None-Match` to get 304 when the copy you hold is the ready one. A roadbook with no file
  yet is made on that first request and answered in the same request when that takes 20 seconds or less; a long route
  is answered `202 {"id", "state": "refreshing"}` with `Retry-After: 5` while the build goes on (one build per roadbook,
  however many times it is asked): poll `GET /roadbooks` until its `state` is `current`, or ask again. After that the
  file is kept on disk. `ready` in the list is false until the first file exists, so a phone can show "to prepare" and
  start it with `POST /roadbook/<id>/refresh` without trying a download first.
- `POST /roadbook/<id>/refresh` asks for a new file: 202 `{"id", "state": "refreshing"}` when it starts (or is
  already running), 200 `{"id", "state"}` when the roadbook is already `current`, 404 for a roadbook that is not the
  rider's. The server makes it in the background, one at a time for the whole server; the phone shows "under refresh"
  and polls `GET /roadbooks` until the state is `current`, then downloads the file. A list also starts, by itself,
  the refresh of an outdated roadbook with a ride dated in the next 14 days. Nothing runs for riders who are not
  asking.
- On a server that runs its own Valhalla (`VALHALLA_URL` set) a rebuilt map makes every roadbook `outdated`, with the
  limits of the new map available on refresh. A change of OpenStreetMap limits that the map has not picked up yet
  is not seen, and neither is the public server's map: its schedule is not the host's.
- Errors: 401 no or wrong token, 404 no such roadbook, 405 wrong method, 429 too many requests, 502 the first file of
  a roadbook could not be made (try again).

## Pushing to a server

A rider who plans on a library that is not on the server can send the file there: `PUT /roadbooks` with
`Authorization: Bearer <rider token>` and the file as the JSON body (up to 5 MiB). The server **adds it to the rider's
own library as a roadbook of theirs**, as if it had been planned there; from then on it is listed, downloaded, refreshed
and deleted like any other roadbook, under an ordinary number.

The answer is `{"id", "stamp", "replaced"}` (`id` is the roadbook's number in that library); 400 for a body that is not a
version 1 roadbook file, 401 for a wrong token, 409 when the library already holds 100 sent roadbooks, 413 too large,
429 too many. A file with an `origin` replaces the earlier push of the same roadbook (the earlier version is kept in
the roadbook's versions, so `restoreRoadbook` brings it back); otherwise the name decides. Pushing an unchanged file
again changes nothing. The file the server then serves keeps the `origin` it was sent with (the app, the roadbook number
and the name in the library it came from), not the number it got in this library, so a phone that already holds that
roadbook recognises it and replaces it in place; the number in `GET /roadbooks` is the one to ask the server with.

What is kept: the line, cut into one leg per pair of waypoints, the waypoints (the `stops` of kind `waypoint`), the
cameras, the distance and the riding time. What is not: the speed limits, countries and roundabouts are traced again on the
server's own map when the file is made for the phone (so they are as good as the server's map and its sources), and the
planned fuel and pause stops are not kept: `refreshRide` plans them again from the rider's bike profile. Roadbooks that
older servers kept as files in a `pushed` folder are brought into the library once, and the folder is renamed
`pushed.imported`.
