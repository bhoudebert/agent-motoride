import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { LatLon } from "../src/geometry.ts";
import { importRoute, MAX_ROUTE_FILE_BYTES, parseRouteFile, readRouteFile } from "../src/routeImport.ts";
import type { CalculateTripInput, TripComputation } from "../src/tools/trip.ts";
import { encodePolyline } from "./helpers/polyline.ts";

const gpx = (tag: "trkpt" | "rtept", points: LatLon[], name = "Col &amp; lacs") =>
  `<?xml version="1.0"?><gpx><${tag === "trkpt" ? "trk" : "rte"}><name>${name}</name>${tag === "trkpt" ? "<trkseg>" : ""}${points
    .map((p) => `<${tag} lat="${p.lat}" lon="${p.lon}"><ele>200</ele></${tag}>`)
    .join("")}${tag === "trkpt" ? "</trkseg>" : ""}</${tag === "trkpt" ? "trk" : "rte"}></gpx>`;

/** A line along an arc of a circle of radius ~20 km: long chords cut the corner. */
function arc(from: number, to: number, n: number): LatLon[] {
  return Array.from({ length: n }, (_, i) => {
    const a = from + ((to - from) * i) / (n - 1);
    return { lat: 50.5 + 0.18 * Math.sin(a), lon: 3 + 0.28 * Math.cos(a) };
  });
}

/** A router that goes straight from waypoint to waypoint, as precisely as a stub can. */
function straightRouter(calls: CalculateTripInput[]) {
  return async (input: CalculateTripInput): Promise<TripComputation> => {
    calls.push(input);
    const stops = input.waypoints.map((w) => {
      const [lat = 0, lon = 0] = w.split(",").map(Number);
      return { lat, lon };
    });
    if (input.roundTrip) stops.push(stops[0]!);
    const shapes = stops.slice(1).map((to, i) => {
      const from = stops[i]!;
      return encodePolyline(
        Array.from({ length: 60 }, (_, k) => ({
          lat: from.lat + ((to.lat - from.lat) * k) / 59,
          lon: from.lon + ((to.lon - from.lon) * k) / 59,
        })),
      );
    });
    return { shapes, complete: true, result: { legs: [] } } as unknown as TripComputation;
  };
}

test("route files: GPX track and route, KML line, name, loop detection", () => {
  const line = arc(0, Math.PI, 30);
  const track = parseRouteFile(gpx("trkpt", line));
  assert.equal(track.points.length, 30);
  assert.equal(track.name, "Col & lacs");
  assert.equal(track.roundTrip, false);
  assert.ok(track.lengthKm > 50 && track.lengthKm < 80, `${track.lengthKm} km`);

  assert.equal(parseRouteFile(gpx("rtept", line.slice(0, 5))).points.length, 5);
  const loop = [...arc(0, 2 * Math.PI, 40)];
  assert.equal(parseRouteFile(gpx("trkpt", loop)).roundTrip, true);

  const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name><![CDATA[Ardennes]]></name><Placemark><LineString><coordinates>
    3.0,50.5,0 3.1,50.6,0
    3.2,50.55
  </coordinates></LineString></Placemark></Document></kml>`;
  const fromKml = parseRouteFile(kml);
  assert.deepEqual(fromKml.points[1], { lat: 50.6, lon: 3.1 });
  assert.equal(fromKml.name, "Ardennes");
  assert.throws(() => parseRouteFile("<gpx><wpt lat='1' lon='2'/></gpx>"), /No route line/);
});

test("route files: only .gpx and .kml, 10 MB at most", () => {
  const dir = mkdtempSync(join(tmpdir(), "ride-import-"));
  const ok = join(dir, "loop.GPX");
  writeFileSync(ok, gpx("trkpt", arc(0, 1, 5)));
  assert.equal(readRouteFile(ok).points.length, 5);
  const other = join(dir, "notes.txt");
  writeFileSync(other, gpx("trkpt", arc(0, 1, 5)));
  assert.throws(() => readRouteFile(other), /only \.gpx and \.kml/);
  const big = join(dir, "big.kml");
  writeFileSync(big, Buffer.alloc(MAX_ROUTE_FILE_BYTES + 1));
  assert.throws(() => readRouteFile(big), /over 10 MB/);
});

test("import: waypoints are added where the router cuts the file's corners, and fidelity rises", async () => {
  const calls: CalculateTripInput[] = [];
  const file = parseRouteFile(gpx("trkpt", arc(0, Math.PI, 400)));
  const result = await importRoute(file, { avoidMotorways: true, route: straightRouter(calls) });
  assert.ok(calls.length > 1, "routed again after the first pass");
  assert.ok(calls.length <= 3);
  assert.ok(calls[1]!.waypoints.length > calls[0]!.waypoints.length, "waypoints added");
  assert.equal(calls[0]!.avoidMotorways, true);
  assert.equal(calls[0]!.roundTrip, false);
  assert.ok(result.fidelityPct >= 90, `fidelity ${result.fidelityPct}%`);
  assert.equal(result.passes, calls.length);
  assert.ok(result.waypoints.length <= 10, "within the router's 10 locations");
});

test("import: a loop is routed as a loop through points of the file", async () => {
  const calls: CalculateTripInput[] = [];
  const file = parseRouteFile(gpx("trkpt", arc(0, 2 * Math.PI, 600)));
  const result = await importRoute(file, { avoidMotorways: false, route: straightRouter(calls) });
  assert.equal(calls[0]!.roundTrip, true);
  assert.ok(calls[0]!.waypoints.length >= 3);
  assert.equal(calls[0]!.waypoints[0], "50.50000,3.28000");
  assert.ok(
    calls.every((c) => c.waypoints.length + 1 <= 10),
    "the return to the start counts as a location",
  );
  // Straight chords cannot follow a 150 km circle with 9 waypoints: the cap holds,
  // and the result says how far from the file it is and where.
  assert.ok(calls.length <= 3);
  assert.ok(result.fidelityPct < 90, `fidelity ${result.fidelityPct}%`);
  assert.ok(result.weakLegs.length > 0 && result.weakLegs.every((l) => l.coveragePct < 85));
});
