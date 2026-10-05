import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyseConditions,
  angleBetween,
  crosswindKmh,
  isGlare,
  sampleRoute,
  solarPosition,
} from "../src/conditions.ts";
import { encodePolyline } from "./helpers/polyline.ts";

const line = (from: { lat: number; lon: number }, to: { lat: number; lon: number }, n = 80) =>
  Array.from({ length: n }, (_, i) => ({
    lat: from.lat + ((to.lat - from.lat) * i) / (n - 1),
    lon: from.lon + ((to.lon - from.lon) * i) / (n - 1),
  }));

test("sun position matches textbook values for Lille", () => {
  const noonOct = solarPosition(50.63, 3.06, new Date("2026-10-11T11:30:00Z"));
  assert.ok(Math.abs(noonOct.azimuthDeg - 180) < 3, String(noonOct.azimuthDeg));
  assert.ok(Math.abs(noonOct.elevationDeg - 32.4) < 1, String(noonOct.elevationDeg));
  const solstice = solarPosition(50.63, 3.06, new Date("2026-06-21T11:40:00Z"));
  assert.ok(Math.abs(solstice.elevationDeg - 62.8) < 1, String(solstice.elevationDeg));
  const evening = solarPosition(50.63, 3.06, new Date("2026-10-11T16:30:00Z"));
  assert.ok(
    evening.azimuthDeg > 240 && evening.azimuthDeg < 265 && evening.elevationDeg > 0 && evening.elevationDeg < 10,
  );
});

test("crosswind is the component across the heading", () => {
  assert.equal(Math.round(crosswindKmh(60, 270, 0)), 60, "west wind, riding north: full crosswind");
  assert.equal(Math.round(crosswindKmh(60, 270, 270)), 0, "headwind: no crosswind");
  assert.equal(Math.round(crosswindKmh(60, 225, 0)), 42, "45 degrees: about 0.71");
  assert.equal(angleBetween(350, 10), 20);
});

test("glare needs a low sun close to the heading", () => {
  assert.equal(isGlare({ azimuthDeg: 255, elevationDeg: 6 }, 260), true);
  assert.equal(isGlare({ azimuthDeg: 255, elevationDeg: 6 }, 180), false);
  assert.equal(isGlare({ azimuthDeg: 255, elevationDeg: 25 }, 255), false);
  assert.equal(isGlare({ azimuthDeg: 255, elevationDeg: -1 }, 255), false);
});

test("route samples: increasing km and time, heading along the road", () => {
  const north = encodePolyline(line({ lat: 50.0, lon: 3.0 }, { lat: 50.36, lon: 3.0 }));
  const samples = sampleRoute([north], [40], 2);
  assert.ok(samples.length >= 19);
  for (let i = 1; i < samples.length; i++)
    assert.ok(samples[i]!.km > samples[i - 1]!.km && samples[i]!.minutes >= samples[i - 1]!.minutes);
  assert.ok(angleBetween(samples[3]!.headingDeg, 0) < 2);
});

test("conditions: west-bound evening leg in October gets low sun; west wind on a north-bound leg gets crosswind", () => {
  const west = encodePolyline(line({ lat: 50.6, lon: 3.6 }, { lat: 50.6, lon: 3.0 }));
  const glare = analyseConditions({
    shapes: [west],
    legMinutes: [45],
    date: "2026-10-11",
    departure: "17:50",
    utcOffsetSeconds: 7200,
  });
  assert.ok(glare.glare.length >= 1, JSON.stringify(glare.summary));
  assert.equal(glare.windChecked, false);
  assert.ok(glare.summary[0]!.startsWith("Low sun ahead"));

  const north = encodePolyline(line({ lat: 50.0, lon: 3.0 }, { lat: 50.36, lon: 3.0 }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, windKmh: 30, gustKmh: 55, windFromDeg: 270 }));
  const windy = analyseConditions({
    shapes: [north],
    legMinutes: [40],
    date: "2026-10-11",
    departure: "10:00",
    utcOffsetSeconds: 7200,
    wind: [{ lat: 50.2, lon: 3.0, hours }],
  });
  assert.equal(windy.crosswind.length, 1, "consecutive flagged samples merge into one stretch");
  assert.ok(windy.crosswind[0]!.value >= 50);
  assert.ok(windy.summary[0]!.startsWith("Strong crosswind"));
});
