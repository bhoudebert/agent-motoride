import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePoint, setGeoAnchor } from "../src/tools/geo.ts";

test("geocoding: the town of that very name wins over a bigger, closer one that only contains it", async () => {
  const real = globalThis.fetch;
  // Open-Meteo's answer for "Le Quesnoy", seen from Coutiches: Quesnoy-sur-Deûle is closer and bigger.
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    assert.equal(url.host, "geocoding-api.open-meteo.com");
    return new Response(
      JSON.stringify({
        results: [
          {
            name: "Quesnoy-sur-Deûle",
            latitude: 50.713,
            longitude: 2.999,
            admin1: "Hauts-de-France",
            country: "France",
            population: 6700,
          },
          {
            name: "Le Quesnoy",
            latitude: 50.248,
            longitude: 3.637,
            admin1: "Hauts-de-France",
            country: "France",
            population: 4900,
          },
          {
            name: "Le Quesnoy",
            latitude: 49.69,
            longitude: 2.5,
            admin1: "Hauts-de-France",
            country: "France",
            population: 200,
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await setGeoAnchor("50.4552,3.20384");
    const point = await resolvePoint("le quesnoy");
    assert.deepEqual([point.lat, point.lon], [50.248, 3.637], "Le Quesnoy near Valenciennes, not the hamlet");
  } finally {
    globalThis.fetch = real;
  }
});
