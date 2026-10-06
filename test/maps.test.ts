import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_POINTS_PER_LINK, navigationPoints, pinnedMapsParts, splitLinks } from "../src/maps.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.0, lon: 3.0 },
  B = { lat: 50.3, lon: 3.4 },
  C = { lat: 50.6, lon: 3.0 };
const shapes = [
  encodePolyline(bentLine(A, B, 60, 0.03)),
  encodePolyline(bentLine(B, C, 60, -0.03)),
  encodePolyline(bentLine(C, A, 60, 0.0)),
];

test("pass-through points go where the road strays from the straight line", () => {
  const points = navigationPoints([A, B, C, A], shapes, [], MAX_POINTS_PER_LINK);
  assert.equal(points.length, MAX_POINTS_PER_LINK);
  const vias = points.filter((p) => p.kind === "via");
  assert.ok(vias.length >= 4);
  // The straight third leg gets none.
  const thirdLegStart = points.filter((p) => p.kind === "waypoint")[2]!.km;
  assert.equal(
    vias.some((v) => v.km > thirdLegStart),
    false,
  );
});

test("links are split at a planned stop, never into a tiny tail", () => {
  const stop = { lat: 50.3, lon: 3.4, label: "pause: X", km: 60 };
  const parts = pinnedMapsParts([A, B, C, A], shapes, [stop]);
  assert.ok(parts.length <= 2);
  for (const part of parts) assert.ok(part.url.split("/dir/")[1]!.split("/").length <= MAX_POINTS_PER_LINK);
  if (parts.length === 2) assert.equal(parts[0]!.to.kind, "stop");
});

test("splitLinks shares the boundary point between parts", () => {
  const points = navigationPoints([A, B, C, A], shapes, [], 12);
  const parts = splitLinks(points, 5);
  assert.ok(parts.length >= 2);
  assert.equal(parts[0]!.to, parts[1]!.from);
});

test("overview: one link over the whole ride, ten points at most, from start to end", async () => {
  const { overviewLink } = await import("../src/maps.ts");
  // A long ride: home, out to a far loop of many waypoints, and back.
  const stops = Array.from({ length: 14 }, (_, i) => ({ lat: 50 + i * 0.05, lon: 3 + (i % 2) * 0.1 }));
  const shapes = stops.slice(1).map((to, i) => encodePolyline(bentLine(stops[i]!, to, 30, 0.01)));
  const url = overviewLink(stops, shapes);
  const points = url.replace("https://www.google.com/maps/dir/", "").split("/");
  assert.equal(points.length, 10);
  assert.equal(points[0], "50.00000,3.00000");
  assert.equal(points.at(-1), `${stops.at(-1)!.lat.toFixed(5)},${stops.at(-1)!.lon.toFixed(5)}`);
  // A short ride keeps its shape with pass-through points, still within one link.
  const short = overviewLink(stops.slice(0, 3), shapes.slice(0, 2)).split("/").length - 5;
  assert.ok(short >= 3 && short <= 10, `${short} points`);
});
