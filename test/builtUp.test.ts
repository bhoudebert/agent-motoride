import assert from "node:assert/strict";
import { test } from "node:test";
import { builtUpFrom, builtUpShare, insideRing } from "../src/builtUp.ts";
import { decodePolyline } from "../src/geometry.ts";
import { buildRoadbookFile } from "../src/roadbookFile.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.4, lon: 3.0 };
const B = { lat: 50.6, lon: 3.4 };
const line = bentLine(A, B, 61, 0.02);
const shapes = [encodePolyline(line)];
const legs = [{ from: "Home", to: "Mont", fromCoords: "50.4,3", toCoords: "50.6,3.4" }];
const FR = [{ country_code: "FR", state_code: "HDF" }];
const edge = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
  length: 20,
  road_class: "secondary",
  density: 2,
  names: ["D 955"],
  begin_shape_index: from,
  end_shape_index: to,
  end_node: { admin_index: 0 },
  ...extra,
});
const tracing = (edges: unknown[]) => async (shape: string) => ({ shape, admins: FR, edges: edges as any[] });
const input = { name: "Loop", description: "", legs, shapes };

/** A square of built-up land around the points whose index lies in [from, to]. */
const landAround = (from: number, to: number) => {
  const pts = line.slice(from, to + 1);
  const pad = 0.01;
  const s = Math.min(...pts.map((p) => p.lat)) - pad;
  const n = Math.max(...pts.map((p) => p.lat)) + pad;
  const w = Math.min(...pts.map((p) => p.lon)) - pad;
  const e = Math.max(...pts.map((p) => p.lon)) + pad;
  return [
    { lat: s, lon: w },
    { lat: s, lon: e },
    { lat: n, lon: e },
    { lat: n, lon: w },
    { lat: s, lon: w },
  ];
};

test("built-up land: a point is inside a ring or not, and a share counts the samples along a stretch", () => {
  const square = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
    { lat: 1, lon: 0 },
    { lat: 0, lon: 0 },
  ];
  assert.equal(insideRing({ lat: 0.5, lon: 0.5 }, square), true);
  assert.equal(insideRing({ lat: 1.5, lon: 0.5 }, square), false);
  const inBuiltUp = builtUpFrom([square]);
  assert.equal(inBuiltUp({ lat: 0.5, lon: 0.5 }), true);
  assert.equal(inBuiltUp({ lat: 2, lon: 2 }), false);
  // A line from inside the square to outside it: about half of it is inside.
  const half = [
    { lat: 0.5, lon: 0.5 },
    { lat: 0.5, lon: 1.5 },
  ];
  assert.ok(Math.abs(builtUpShare(half, 0, 1, inBuiltUp) - 0.5) < 0.05);
  assert.equal(builtUpShare([], 0, 1, inBuiltUp), 0);
});

test("roadbook file: an untagged road through built-up land is 50 and marked inferred, the rest keeps its default", async () => {
  const rings = [landAround(0, 30)];
  const { file, builtUpError } = await buildRoadbookFile(input, tracing([edge(0, 30), edge(30, 60)]), async () =>
    builtUpFrom(rings),
  );
  assert.equal(builtUpError, null);
  assert.deepEqual(
    file.limits.map((l) => [l.from, l.to, l.kmh, l.posted, l.source]),
    [
      [0, 30, 50, false, "inferred"],
      [30, 60, 80, false, undefined],
    ],
  );
  assert.equal(decodePolyline(file.line).length, 61);
});

test("roadbook file: a posted limit is never changed by built-up land", async () => {
  const { file } = await buildRoadbookFile(input, tracing([edge(0, 60, { speed_limit: 80 })]), async () =>
    builtUpFrom([landAround(0, 60)]),
  );
  assert.deepEqual(
    file.limits.map((l) => [l.kmh, l.posted, l.source]),
    [[80, true, undefined]],
  );
});

test("roadbook file: when the map service fails the defaults stand and the file says so", async () => {
  const { file, builtUpError } = await buildRoadbookFile(input, tracing([edge(0, 60)]), async () => {
    throw new Error("Overpass is down");
  });
  assert.equal(file.limits[0]!.kmh, 80);
  assert.match(builtUpError ?? "", /Built-up areas not checked \(Overpass is down\)/);
});

test("roadbook file: without a built-up lookup nothing is inferred", async () => {
  const { file, builtUpError } = await buildRoadbookFile(input, tracing([edge(0, 60)]));
  assert.equal(file.limits[0]!.kmh, 80);
  assert.equal(file.limits[0]!.source, undefined);
  assert.equal(builtUpError, null);
});
