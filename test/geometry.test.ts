import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePolyline, overlapPct, routeCells } from "../src/geometry.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

test("polyline round trip", () => {
  const line = bentLine({ lat: 50.1234, lon: 3.1 }, { lat: 50.5, lon: 3.6 }, 20, 0.01);
  const back = decodePolyline(encodePolyline(line));
  assert.equal(back.length, line.length);
  assert.ok(Math.abs(back[7]!.lat - line[7]!.lat) < 1e-5);
});

test("same roads overlap fully, other roads not at all", () => {
  const a = routeCells([encodePolyline(bentLine({ lat: 50, lon: 3 }, { lat: 50.4, lon: 3.5 }, 80, 0.02))]);
  // Same road ridden the other way: same curve, so the same bulge sign.
  const reversed = routeCells([encodePolyline(bentLine({ lat: 50.4, lon: 3.5 }, { lat: 50, lon: 3 }, 80, 0.02))]);
  const elsewhere = routeCells([encodePolyline(bentLine({ lat: 51, lon: 4 }, { lat: 51.4, lon: 4.5 }, 80, 0.02))]);
  assert.ok(overlapPct(a, new Set(a)) === 100);
  assert.ok(overlapPct(a, new Set(reversed)) > 80);
  assert.equal(overlapPct(a, new Set(elsewhere)), 0);
});
