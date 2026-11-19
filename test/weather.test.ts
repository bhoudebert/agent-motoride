import assert from "node:assert/strict";
import { test } from "node:test";
import { installFakeServices } from "./helpers/fakeServices.ts";
import { encodePolyline } from "./helpers/polyline.ts";

const fake = installFakeServices();
const { FORECAST_MODELS, getDaylight, getWeather, sunTimes, utcOffsetSecondsOn } =
  await import("../src/tools/weather.ts");

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

/** 24 hourly values, `at` overriding some hours. */
const day = (value: number | null, at: Record<number, number> = {}) =>
  Array.from({ length: 24 }, (_, h) => at[h] ?? value);

/** Runs `body` with some forecast models answering other values, then puts the defaults back. */
async function withModels<T>(forecast: Record<string, Record<string, (number | null)[]>>, body: () => Promise<T>) {
  fake.forecast = forecast;
  try {
    return await body();
  } finally {
    fake.forecast = undefined;
  }
}

test("forecast: several models asked in one request", async () => {
  const realFetch = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    urls.push(new URL(String(input instanceof Request ? input.url : input)));
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    await getWeather({ location: "Lille", date: "2026-10-10", fromHour: 9, toHour: 10 });
  } finally {
    globalThis.fetch = realFetch;
  }
  const forecast = urls.filter((u) => u.host === "api.open-meteo.com");
  assert.equal(forecast.length, 1);
  assert.equal(forecast[0]!.searchParams.get("models"), "meteofrance_seamless,icon_seamless,ecmwf_ifs025,best_match");
  assert.deepEqual([...FORECAST_MODELS], forecast[0]!.searchParams.get("models")!.split(","));
});

test("forecast: one model dry and another wet in the same hour is the wet reading, and they disagree", async () => {
  const w = await withModels(
    {
      meteofrance_seamless: { precipitation: day(0) },
      icon_seamless: { precipitation: day(0, { 9: 2 }) },
      ecmwf_ifs025: { precipitation: day(0, { 9: 0.3 }), precipitation_probability: day(10, { 9: 40 }) },
      best_match: { precipitation: day(0, { 9: 2.9 }), weather_code: day(2, { 9: 61 }) },
    },
    () => getWeather({ location: "Lille", date: "2026-11-20", fromHour: 8, toHour: 10 }),
  );
  const nine = w.hours.find((h) => h.hour === 9)!;
  assert.equal(nine.rainMm, 2.9);
  assert.equal(nine.rainProbPct, 40, "the highest probability a model gives");
  assert.equal(nine.sky, "rain", "the most severe sky");
  assert.deepEqual(Object.fromEntries(Object.entries(nine.models).map(([m, r]) => [m, r.rainMm])), {
    meteofrance_seamless: 0,
    icon_seamless: 2,
    ecmwf_ifs025: 0.3,
    best_match: 2.9,
  });
  assert.equal(w.summary.dry, false);
  assert.equal(w.summary.totalRainMm, 2.9);
  assert.equal(w.summary.modelsDisagree, true);
  assert.match(
    w.summary.disagreement!,
    /^Models disagree: 09h rain 0-2\.9 mm \(meteofrance_seamless dry, best_match 2\.9 mm\)/,
  );
  assert.deepEqual(
    w.summary.models.map((m) => [m.model, m.totalRainMm]),
    [
      ["meteofrance_seamless", 0],
      ["icon_seamless", 2],
      ["ecmwf_ifs025", 0.3],
      ["best_match", 2.9],
    ],
  );
});

test("forecast: the strongest gust of the models, with its direction, and a wide gust spread disagrees", async () => {
  const w = await withModels(
    {
      best_match: { wind_gusts_10m: day(25, { 8: 29 }) },
      meteofrance_seamless: { wind_gusts_10m: day(25, { 8: 38 }), wind_direction_10m: day(270, { 8: 250 }) },
      icon_seamless: { wind_gusts_10m: day(25, { 8: 11 }), wind_speed_10m: day(12, { 8: 20 }) },
      ecmwf_ifs025: { wind_gusts_10m: day(25, { 8: 35 }) },
    },
    () => getWeather({ location: "Lille", date: "2026-11-20", fromHour: 8, toHour: 9 }),
  );
  const eight = w.hours.find((h) => h.hour === 8)!;
  assert.equal(eight.gustKmh, 38);
  assert.equal(eight.windFromDeg, 250, "the direction of the model with the strongest gust");
  assert.equal(eight.windKmh, 20);
  assert.equal(w.summary.maxGustKmh, 38);
  assert.equal(w.summary.dry, true, "they agree on rain");
  assert.equal(w.summary.modelsDisagree, true);
  assert.match(w.summary.disagreement!, /08h gusts 11-38 km\/h \(icon_seamless to meteofrance_seamless\)/);
  assert.doesNotMatch(w.summary.disagreement!, /09h/, "25 km/h everywhere at 9h");
});

test("forecast: a model with no data for the place is ignored, not read as zero", async () => {
  const empty = day(null);
  const w = await withModels(
    {
      meteofrance_seamless: {
        temperature_2m: empty,
        precipitation: empty,
        wind_speed_10m: empty,
        wind_gusts_10m: empty,
        wind_direction_10m: empty,
        weather_code: empty,
      },
      icon_seamless: { precipitation: day(0.5), temperature_2m: day(9) },
      best_match: { temperature_2m: day(11) },
    },
    () => getWeather({ location: "Lille", date: "2026-11-20", fromHour: 9, toHour: 9 }),
  );
  const [nine] = w.hours;
  assert.deepEqual(Object.keys(nine!.models), ["icon_seamless", "ecmwf_ifs025", "best_match"]);
  assert.equal(nine!.tempC, 11, "best_match when AROME has nothing");
  assert.equal(nine!.rainMm, 0.5);
  assert.equal(w.summary.modelsDisagree, false, "0 and 0.5 mm are not a wide spread");
  assert.equal(w.summary.dry, false);
});

test("forecast: models that agree are dry and do not disagree, temperature from AROME", async () => {
  const w = await withModels(
    { meteofrance_seamless: { temperature_2m: day(13) }, best_match: { temperature_2m: day(15) } },
    () => getWeather({ location: "Lille", date: "2026-10-10", fromHour: 9, toHour: 12 }),
  );
  assert.equal(w.summary.dry, true);
  assert.equal(w.summary.modelsDisagree, false);
  assert.equal(w.summary.disagreement, null);
  assert.equal(w.hours[0]!.tempC, 13);
  assert.equal(w.hours[0]!.rainProbPct, 10, "AROME has no probability; the others give it");
});

test("crosswind uses the strongest gust of the models", async () => {
  const { analyseConditions, windAlong } = await import("../src/conditions.ts");
  const north = encodePolyline(Array.from({ length: 80 }, (_, i) => ({ lat: 50.0 + (0.36 * i) / 79, lon: 3.0 })));
  const wind = await withModels(
    {
      meteofrance_seamless: { wind_gusts_10m: day(38) },
      icon_seamless: { wind_gusts_10m: day(11) },
      ecmwf_ifs025: { wind_gusts_10m: day(29) },
      best_match: { wind_gusts_10m: day(17) },
    },
    () => windAlong([north], "2026-11-20", getWeather),
  );
  const c = analyseConditions({
    shapes: [north],
    legMinutes: [40],
    date: "2026-11-20",
    departure: "10:00",
    utcOffsetSeconds: 3600,
    wind: wind.points,
  });
  assert.equal(c.crosswind.length, 1);
  assert.match(c.crosswind[0]!.detail, /^gusts 38 km\/h from W, 38 km\/h across/);
});

test("briefing: forecast models that disagree are a caution, and the rain is judged on the wettest", async () => {
  const { Store } = await import("../src/store.ts");
  const { rideBriefing } = await import("../src/briefing.ts");
  const { DEFAULT_PREFERENCES } = await import("../src/preferences.ts");
  const store = new Store(":memory:");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const shape = encodePolyline(Array.from({ length: 40 }, (_, i) => ({ lat: 50.63 + 0.004 * i, lon: 3.05 })));
  const id = store.saveRide({
    name: "Pont-à-Marcq",
    parentId: null,
    home: "Lille",
    rideDate: tomorrow,
    departure: "09:00",
    distanceKm: 40,
    ridingMinutes: 60,
    waypoints: ["Lille", "Cassel"],
    roundTrip: false,
    speedLimits: {},
    preferences: DEFAULT_PREFERENCES,
    request: "a short ride",
    itinerary: "text",
    mapsUrl: "m",
    cells: [],
    shapes: [shape],
    centerLat: 50.7,
    centerLon: 3.05,
    usage: null,
    extras: null,
    legs: [
      {
        seq: 1,
        from: "Lille",
        to: "Cassel",
        fromCoords: "50.63,3.05",
        toCoords: "50.79,3.05",
        distanceKm: 40,
        ridingMinutes: 60,
        mainRoads: [],
      },
    ],
  });
  const text = await withModels(
    {
      meteofrance_seamless: { precipitation: day(0) },
      best_match: { precipitation: day(0, { 9: 2.9 }) },
    },
    () => rideBriefing(store, store.findRide(String(id))!, tomorrow),
  );
  assert.match(text, /Forecast models disagree at start: 09h rain 0-2\.9 mm/);
  assert.match(text, /Rain risk at start.*2\.9 mm/);
  assert.match(text, /models disagree/i);
});

test("daylight tool resolves the place and localises the times", async () => {
  const d = await getDaylight({ location: "Lille", date: "2026-10-11" });
  assert.equal(d.timezone, "Europe/Paris");
  assert.ok(Math.abs(toMin(d.sunrise!) - toMin("08:02")) <= 4);
});

test("traffic: the delay is expected congestion, not only reported incidents", async () => {
  const { getTraffic } = await import("../src/tools/traffic.ts");
  const key = process.env.TOMTOM_API_KEY;
  process.env.TOMTOM_API_KEY = "test-key";
  try {
    const traffic = await getTraffic({ waypoints: ["Lille", "Cassel"], departAt: "2026-10-12T07:30:00" });
    assert.ok(traffic.available);
    assert.equal(traffic.travelMinutes, 106);
    assert.equal(traffic.freeFlowMinutes, 83);
    assert.equal(traffic.trafficDelayMinutes, 23);
    assert.equal(traffic.incidentDelayMinutes, 0);
    delete process.env.TOMTOM_API_KEY;
    assert.equal((await getTraffic({ waypoints: ["Lille"], departAt: "2026-10-12T07:30:00" })).available, false);
  } finally {
    if (key === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = key;
  }
});
