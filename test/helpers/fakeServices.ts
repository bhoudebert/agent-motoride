// Replaces global fetch with canned answers for every external service the
// planner touches, plus a scripted Claude API. Nothing leaves the process.
import { bentLine, encodePolyline } from "./polyline.ts";

export interface FakeApi {
  /** Replies to return, in order, for calls to the Claude API. */
  script: unknown[];
  /** Request bodies received by the Claude API. */
  requests: any[];
  /** Elements returned by every Overpass query (cameras, stops, roads). */
  overpass: unknown[];
}

const PLACES: Record<string, { lat: number; lon: number; name: string }> = {
  lille: { lat: 50.6339, lon: 3.0551, name: "Lille" },
  cassel: { lat: 50.8011, lon: 2.4853, name: "Cassel" },
  "mont des cats": { lat: 50.7831, lon: 2.6678, name: "Mont des Cats" },
  grenoble: { lat: 45.1787, lon: 5.7148, name: "Grenoble" },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function installFakeServices(): FakeApi {
  const api: FakeApi = { script: [], requests: [], overpass: [] };
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    // Overpass bodies are form-encoded; every other service sends JSON.
    const raw = init?.body ? String(init.body) : "";
    const body = raw.startsWith("{") ? JSON.parse(raw) : null;

    if (url.hostname === "api.anthropic.com") {
      api.requests.push(body);
      const reply = api.script.shift();
      if (!reply)
        return json(
          { type: "error", error: { type: "invalid_request_error", message: "fake API: script exhausted" } },
          400,
        );
      return json(reply);
    }
    if (url.host === "geocoding-api.open-meteo.com") {
      const name = (url.searchParams.get("name") ?? "").toLowerCase();
      const place = PLACES[name];
      return json({
        results: place
          ? [
              {
                name: place.name,
                latitude: place.lat,
                longitude: place.lon,
                country: "France",
                country_code: "FR",
                admin1: "Hauts-de-France",
                population: 10000,
              },
            ]
          : [],
      });
    }
    if (url.host === "api.open-meteo.com") {
      const hours = Array.from({ length: 24 }, (_, h) => h);
      return json({
        timezone: "Europe/Paris",
        utc_offset_seconds: 7200,
        hourly: {
          time: hours.map((h) => `2026-10-10T${String(h).padStart(2, "0")}:00`),
          temperature_2m: hours.map(() => 14),
          precipitation_probability: hours.map(() => 10),
          precipitation: hours.map(() => 0),
          wind_speed_10m: hours.map(() => 12),
          wind_gusts_10m: hours.map(() => 25),
          wind_direction_10m: hours.map(() => 270),
          weather_code: hours.map(() => 2),
        },
      });
    }
    if (url.host === "valhalla1.openstreetmap.de" && url.pathname === "/route") {
      const locations: Array<{ lat: number; lon: number }> = body.locations;
      const legs = locations.slice(1).map((to, i) => {
        const from = locations[i]!;
        const line = bentLine(from, to, 40, 0.02);
        return {
          shape: encodePolyline(line),
          summary: { length: 40 + i * 5, time: 3000 + i * 300, has_highway: false, has_toll: false },
        };
      });
      return json({
        trip: {
          summary: {
            length: legs.reduce((s, l) => s + l.summary.length, 0),
            time: legs.reduce((s, l) => s + l.summary.time, 0),
          },
          legs,
        },
      });
    }
    if (url.host === "valhalla1.openstreetmap.de" && url.pathname === "/trace_attributes") {
      // Two edges per leg: an 80 road in the country, a 50 street in a village.
      // Like the real router, an "include" filter returns only the requested edge attributes.
      const requested = body.filters?.action === "include" ? new Set<string>(body.filters.attributes) : undefined;
      const keep = (edge: Record<string, unknown>) =>
        requested
          ? Object.fromEntries(
              Object.entries(edge).filter(([key]) =>
                key === "end_node" ? requested.has("node.admin_index") : requested.has(`edge.${key}`),
              ),
            )
          : edge;
      return json({
        shape: body.encoded_polyline,
        admins: [{ country_code: "FR", state_code: "HDF" }],
        edges: [
          {
            length: 30,
            speed_limit: 80,
            road_class: "secondary",
            density: 2,
            surface: "paved_smooth",
            names: ["D 938"],
            begin_shape_index: 0,
            end_shape_index: 30,
            end_node: { admin_index: 0 },
          },
          {
            length: 10,
            speed_limit: 50,
            road_class: "tertiary",
            density: 7,
            surface: "paved_rough",
            names: ["Rue de la Gare"],
            begin_shape_index: 30,
            end_shape_index: 39,
            end_node: { admin_index: 0 },
          },
        ].map(keep),
      });
    }
    if (url.host === "photon.komoot.io")
      return json({
        features: [
          {
            geometry: { coordinates: [url.searchParams.get("lon"), url.searchParams.get("lat")] },
            properties: { name: "D 938", city: "Somewhere", osm_key: "highway", osm_value: "secondary" },
          },
        ],
      });
    if (url.host.includes("overpass")) return json({ elements: api.overpass });
    if (url.host === "nominatim.openstreetmap.org") return json([]);
    if (url.host === "api.tomtom.com")
      // Monday rush hour: 106 min expected, 83 without traffic, no incident reported.
      return json({
        routes: [
          {
            summary: {
              lengthInMeters: 114395,
              travelTimeInSeconds: 6354,
              trafficDelayInSeconds: 0,
              noTrafficTravelTimeInSeconds: 4953,
            },
          },
        ],
      });
    throw new Error(`fake services: unexpected call to ${url.host}${url.pathname}`);
  }) as typeof fetch;
  return api;
}

const usage = {
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 500,
  cache_creation_input_tokens: 300,
};
export const message = (content: unknown[], stop_reason: string, model = "claude-sonnet-5-5") => ({
  id: "msg_fake",
  type: "message",
  role: "assistant",
  model,
  content,
  stop_reason,
  stop_sequence: null,
  usage,
});
export const toolUse = (name: string, input: unknown, id = `tu_${Math.random().toString(36).slice(2, 8)}`) =>
  message([{ type: "tool_use", id, name, input }], "tool_use");
export const finalText = (text: string) => message([{ type: "text", text }], "end_turn");
