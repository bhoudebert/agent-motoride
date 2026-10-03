import assert from "node:assert/strict";
import { test } from "node:test";
import { navigationPoints, pinnedMapsParts, splitLinks, MAX_POINTS_PER_LINK } from "../src/maps.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.0, lon: 3.0 }, B = { lat: 50.3, lon: 3.4 }, C = { lat: 50.6, lon: 3.0 };
const shapes = [encodePolyline(bentLine(A, B, 60, 0.03)), encodePolyline(bentLine(B, C, 60, -0.03)), encodePolyline(bentLine(C, A, 60, 0.0))];

test("pass-through points go where the road strays from the straight line", () => {
  const points = navigationPoints([A, B, C, A], shapes, [], MAX_POINTS_PER_LINK);
  assert.equal(points.length, MAX_POINTS_PER_LINK);
  const vias = points.filter((p) => p.kind === "via");
  assert.ok(vias.length >= 4);
  // The straight third leg gets none.
  const thirdLegStart = points.filter((p) => p.kind === "waypoint")[2]!.km;
  assert.equal(vias.some((v) => v.km > thirdLegStart), false);
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
