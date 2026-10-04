import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePolyline, routeCells } from "./geometry.ts";
import { navigationPoints } from "./maps.ts";
import type { SavedRide, Store } from "./store.ts";
import { setGeoAnchor } from "./tools/geo.ts";
import { computeTrip } from "./tools/trip.ts";

const EXPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "exports");

export interface GpxLeg {
  from: string;
  to: string;
  fromCoords: string;
  toCoords: string;
  mainRoads: string[];
}

export interface GpxInput {
  name: string;
  description: string;
  legs: GpxLeg[];
  /** One encoded polyline per leg, as returned by the router. */
  shapes: string[];
  /** Planned stops, shown as named waypoints and route stages. */
  stops?: Array<{ lat: number; lon: number; label: string; km?: number }>;
  /** Cap on route points (stops plus pass-through pins); default 40. Fewer makes a cleaner stage list. */
  maxRoutePoints?: number;
}

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const point = (coords: string) => {
  const [lat = "0", lon = "0"] = coords.split(",");
  return `lat="${Number(lat).toFixed(6)}" lon="${Number(lon).toFixed(6)}"`;
};

/** Route points an app that recomputes its own path can take without drifting. */
const ROUTE_POINTS_MAX = 40;

/** Position of each planned stop in the GPX route point list, as the importing app numbers them. */
export function routePointIndex(
  input: GpxInput,
  maxPoints = input.maxRoutePoints ?? ROUTE_POINTS_MAX,
): Array<{ label: string; index: number; total: number }> {
  const points = gpxRoutePoints(input, maxPoints);
  return points.flatMap((p, i) =>
    p.kind === "stop" ? [{ label: p.label ?? "stop", index: i + 1, total: points.length }] : [],
  );
}

function gpxRoutePoints(input: GpxInput, maxPoints: number) {
  const loopPoints = [input.legs[0]!.fromCoords, ...input.legs.map((leg) => leg.toCoords)].map((coords, i, all) => {
    const [lat = 0, lon = 0] = coords.split(",").map(Number);
    return {
      lat,
      lon,
      label:
        i === 0
          ? `Start: ${input.legs[0]!.from}`
          : i === all.length - 1
            ? `Finish: ${input.legs.at(-1)!.to}`
            : `${i}. ${input.legs[i - 1]!.to}`,
    };
  });
  const plannedStops = (input.stops ?? []).map((s) => ({ lat: s.lat, lon: s.lon, label: s.label, km: s.km ?? 0 }));
  return navigationPoints(loopPoints, input.shapes, plannedStops, maxPoints);
}

/**
 * GPX 1.1 with three views of the same ride, so any app finds what it reads:
 * - waypoints: the start, each stop of the loop, and the planned fuel and
 *   pause stops, as named markers;
 * - a route for apps that compute their own path between points (Liberty
 *   Rider, Garmin, TomTom): the loop's stops, the planned stops as named
 *   stages, and pass-through points taken from the exact line where such an
 *   app would otherwise leave the chosen road;
 * - a track with the exact road geometry, one segment per leg, for apps that
 *   follow a line.
 */
export function buildGpx(input: GpxInput): string {
  const stops = [
    { coords: input.legs[0]!.fromCoords, name: `Start: ${input.legs[0]!.from}` },
    ...input.legs.map((leg, i) => ({
      coords: leg.toCoords,
      name: i === input.legs.length - 1 ? `Finish: ${leg.to}` : `${i + 1}. ${leg.to}`,
    })),
  ];
  const waypoints = [
    ...stops.map((s) => `  <wpt ${point(s.coords)}><name>${xml(s.name)}</name></wpt>`),
    ...(input.stops ?? []).map(
      (s) =>
        `  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}"><name>${xml(s.label)}</name><sym>Flag</sym></wpt>`,
    ),
  ];

  // Route points: loop stops, planned stops and pass-through pins, in riding order.
  const routePoints = gpxRoutePoints(input, input.maxRoutePoints ?? ROUTE_POINTS_MAX).map((p) => {
    const name = p.kind === "via" ? `via km ${p.km.toFixed(0)}` : (p.label ?? "Stop");
    return `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${xml(name)}</name>${p.kind === "via" ? "<type>via</type>" : ""}</rtept>`;
  });
  const segments = input.shapes.map((shape, i) => {
    const leg = input.legs[i];
    const comment = leg ? `    <!-- leg ${i + 1}: ${xml(leg.from)} to ${xml(leg.to)} -->\n` : "";
    const points = decodePolyline(shape).map(
      (p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`,
    );
    return `${comment}    <trkseg>\n${points.join("\n")}\n    </trkseg>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="agentRide" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xml(input.name)}</name>
    <desc>${xml(input.description)}</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
${waypoints.join("\n")}
  <rte>
    <name>${xml(input.name)}</name>
    <desc>Stops and pass-through points; an app that computes its own path between points stays on the planned roads.</desc>
${routePoints.join("\n")}
  </rte>
  <trk>
    <name>${xml(input.name)}</name>
${segments.join("\n")}
  </trk>
</gpx>
`;
}

/** Write a GPX file, by default into exports/ in the project. Returns the absolute path. */
export function writeGpx(input: GpxInput, id: string | number, file?: string): string {
  const slug = input.name
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const path = resolve(file?.trim() || resolve(EXPORT_DIR, `${id}-${slug || "ride"}.gpx`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildGpx(input));
  return path;
}

/**
 * The GPX content of a saved ride. Rides saved before route lines were stored
 * are routed again from their waypoints, and the line is then kept for next time.
 */
export async function savedRideGpx(store: Store, ride: SavedRide): Promise<{ gpx: GpxInput; rerouted: boolean }> {
  let shapes = ride.shapes;
  let legs: GpxLeg[] = ride.legs;
  const rerouted = !shapes;
  if (!shapes) {
    await setGeoAnchor(ride.home);
    const trip = await computeTrip({
      waypoints: ride.waypoints,
      roundTrip: ride.roundTrip,
      avoidMotorways: ride.preferences.avoidMotorways,
    });
    shapes = trip.shapes;
    legs = trip.result.legs;
    // Only keep the line if the ride still routes into the same legs.
    if (trip.result.legs.length === ride.legs.length) store.setRouteLine(ride.id, shapes, routeCells(shapes));
  }
  const hours = `${Math.floor(ride.ridingMinutes / 60)}h${String(ride.ridingMinutes % 60).padStart(2, "0")}`;
  const stops = (ride.extras?.stopPlan?.stops ?? []).map((s) => {
    const [lat = 0, lon = 0] = s.coords.split(",").map(Number);
    return { lat, lon, label: `${s.kind}: ${s.name}${s.where ? `, ${s.where}` : ""} (${s.eta})`, km: s.kmAlongRoute };
  });
  return {
    rerouted,
    gpx: {
      name: ride.name,
      description: `${ride.distanceKm} km, about ${hours} riding. Planned with agentRide from ${ride.home}.`,
      legs,
      shapes,
      stops,
    },
  };
}

/** Export a saved ride as a GPX file. */
export async function exportSavedRide(
  store: Store,
  ride: SavedRide,
  file?: string,
  maxRoutePoints?: number,
): Promise<{ path: string; rerouted: boolean; stopsAt: Array<{ label: string; index: number; total: number }> }> {
  const { gpx, rerouted } = await savedRideGpx(store, ride);
  const input = { ...gpx, maxRoutePoints };
  return { path: writeGpx(input, ride.id, file), rerouted, stopsAt: routePointIndex(input) };
}

/** "pause: X at route point 18 of 40" lines, for the rider to find the stops in an app's stage list. */
export function describeStopsAt(stopsAt: Array<{ label: string; index: number; total: number }>): string[] {
  return stopsAt.map((s) => `  ${s.label}: route point ${s.index} of ${s.total}`);
}
