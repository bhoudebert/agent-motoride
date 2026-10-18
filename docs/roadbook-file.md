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
  "cameras": [{ "lat": 50.52, "lon": 3.31, "kmh": 70, "bearing": 90, "direction": null }]
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
  `posted` tells a tagged limit (true) from an assumed one, the country or built-up default (false), `road` is the
  road ref or name, optional. Entries are in order and should not overlap; a gap means unknown. Optional.
- `cameras`: fixed speed cameras near the line. `kmh` is the camera's limit or null. `bearing` is the direction the
  camera faces, degrees clockwise from north (0 to 359), when OpenStreetMap gives it as degrees or a compass point;
  the camera then watches traffic travelling the opposite way. `direction` is `both` or null: OpenStreetMap's
  `forward` and `backward` are relative to the way, not to the line, so they are not exported. Optional. The app shows them as danger zones, never as camera
  positions (`openspec/specs/danger-zones`).

## Rules for the producer

- `limits` indexes refer to the `line` as written. A producer that routes and traces separately must write the
  line it traced, so the indexes hold.
- Distances are never stored: the reader measures the line itself.
- Coordinates are WGS84 degrees. Strings are UTF-8.
- Data comes from OpenStreetMap: keep its attribution with the file's use.
