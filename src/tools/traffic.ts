import { fetchJson } from "../http.ts";
import { resolveWaypoints } from "./trip.ts";

export interface GetTrafficInput {
  waypoints: string[];
  departAt: string; // ISO local datetime, e.g. 2026-10-03T09:00:00
  roundTrip?: boolean;
  avoidMotorways?: boolean;
}

interface TomTomResponse {
  routes: Array<{
    summary: {
      lengthInMeters: number;
      travelTimeInSeconds: number;
      trafficDelayInSeconds: number;
      noTrafficTravelTimeInSeconds?: number;
    };
  }>;
}

/**
 * Expected traffic delay along a route at a given departure time (TomTom
 * Routing API, uses live + historical traffic). Needs TOMTOM_API_KEY.
 */
export async function getTraffic(input: GetTrafficInput) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      reason: "No traffic data source configured (TOMTOM_API_KEY is not set). Do not guess traffic conditions.",
    };
  }

  const points = await resolveWaypoints(input.waypoints, input.roundTrip);
  const locations = points.map((p) => `${p.lat},${p.lon}`).join(":");
  const url = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${locations}/json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("traffic", "true");
  url.searchParams.set("travelMode", "motorcycle");
  url.searchParams.set("departAt", input.departAt);
  url.searchParams.set("computeTravelTimeFor", "all");
  if (input.avoidMotorways ?? true) url.searchParams.set("avoid", "motorways");
  const data = await fetchJson<TomTomResponse>(url.toString());
  const summary = data.routes[0]?.summary;
  if (!summary) throw new Error("TomTom returned no route");

  return {
    available: true,
    departAt: input.departAt,
    distanceKm: Number((summary.lengthInMeters / 1000).toFixed(1)),
    travelMinutes: Math.round(summary.travelTimeInSeconds / 60),
    freeFlowMinutes:
      summary.noTrafficTravelTimeInSeconds === undefined ? null : Math.round(summary.noTrafficTravelTimeInSeconds / 60),
    // TomTom's trafficDelayInSeconds counts reported incidents only; the expected
    // congestion for the departure (rush hour) is the gap to the free-flow time.
    trafficDelayMinutes: Math.round(
      Math.max(
        summary.noTrafficTravelTimeInSeconds === undefined
          ? summary.trafficDelayInSeconds
          : summary.travelTimeInSeconds - summary.noTrafficTravelTimeInSeconds,
        0,
      ) / 60,
    ),
    incidentDelayMinutes: Math.round(summary.trafficDelayInSeconds / 60),
  };
}
