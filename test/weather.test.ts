import assert from "node:assert/strict";
import { test } from "node:test";
import { installFakeServices } from "./helpers/fakeServices.ts";

installFakeServices();
const { getDaylight, getWeather, sunTimes, utcOffsetSecondsOn } = await import("../src/tools/weather.ts");

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test("timezone offset follows summer and winter time", () => {
  assert.equal(utcOffsetSecondsOn("Europe/Paris", "2026-07-01"), 7200);
  assert.equal(utcOffsetSecondsOn("Europe/Paris", "2026-12-21"), 3600);
  assert.equal(utcOffsetSecondsOn("UTC", "2026-07-01"), 0);
});

test("sun times near Lille match the published values within a few minutes", () => {
  // Reference for Lille, 11 October 2026: sunrise 08:02, sunset 19:07 (Paris time).
  const t = sunTimes(50.63, 3.06, "2026-10-11", 7200)!;
  assert.ok(Math.abs(toMin(t.sunrise) - toMin("08:02")) <= 4, t.sunrise);
  assert.ok(Math.abs(toMin(t.sunset) - toMin("19:07")) <= 4, t.sunset);
  assert.ok(toMin(t.firstLight!) < toMin(t.sunrise) && toMin(t.lastLight!) > toMin(t.sunset));
  const winter = sunTimes(50.63, 3.06, "2026-12-21", 3600)!;
  assert.ok(winter.daylightHours < 8.5 && winter.daylightHours > 7.5, String(winter.daylightHours));
});

test("polar night has no sunrise", () => {
  assert.equal(sunTimes(78.2, 15.6, "2026-12-21", 3600), null);
});

test("forecast: hours filtered, summary flags a dry day, daylight attached", async () => {
  const w = await getWeather({ location: "Lille", date: "2026-10-10", fromHour: 9, toHour: 12 });
  assert.equal(w.hours.length, 4);
  assert.equal(w.summary.dry, true);
  assert.equal(w.summary.maxGustKmh, 25);
  assert.ok(w.daylight?.sunrise);
});

test("daylight tool resolves the place and localises the times", async () => {
  const d = await getDaylight({ location: "Lille", date: "2026-10-11" });
  assert.equal(d.timezone, "Europe/Paris");
  assert.ok(Math.abs(toMin(d.sunrise!) - toMin("08:02")) <= 4);
});
