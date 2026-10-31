import { overpassBuiltUp } from "./builtUp.ts";
import { configuredSigns } from "./signs.ts";
import { exportDir, inRoot } from "./requestContext.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePolyline, routeCells } from "./geometry.ts";
import { navigationPoints } from "./maps.ts";
import type { SavedRide, Store } from "./store.ts";
import { startLabel, startPoint } from "./start.ts";
import { buildRoadbookFile } from "./roadbookFile.ts";
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
<gpx version="1.1" creator="agentMotoride" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xml(input.name)}</name>
    <desc>${xml(input.description)}</desc>
    <copyright author="OpenStreetMap contributors"><license>https://www.openstreetmap.org/copyright</license></copyright>
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
  const path = resolve(
    inRoot(file?.trim() || resolve(exportDir(EXPORT_DIR), `${id}-${slug || "ride"}.gpx`), "exports"),
  );
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
    await setGeoAnchor(startPoint(ride));
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
      description: `${ride.distanceKm} km, about ${hours} riding. Planned with agentMotoride from ${startLabel(ride)}.`,
      legs,
      shapes,
      stops,
    },
  };
}

/** Where the roadbook file goes: next to the GPX, same name, `.motoride.json`. */
export function roadbookFilePath(gpxPath: string): string {
  return `${gpxPath.replace(/\.gpx$/i, "")}.motoride.json`;
}

/**
 * Which roadbook the file says it is. A roadbook sent from another library (importRoadbookFile) keeps the origin it was sent with, so
 * the phone recognises it as the roadbook it already holds; every other roadbook is itself, by its number in this library and its day.
 */
export function originOf(ride: Pick<SavedRide, "id" | "rideDayId" | "name" | "request">): {
  roadbook: number;
  ride: number | null;
  name: string;
} {
  const sent = /^roadbook file agentRide:(\d+):/.exec(ride.request);
  return sent
    ? { roadbook: Number(sent[1]), ride: null, name: ride.name }
    : { roadbook: ride.id, ride: ride.rideDayId, name: ride.name };
}

function roadbookInput(ride: SavedRide, gpx: GpxInput) {
  return {
    name: gpx.name,
    description: gpx.description,
    legs: gpx.legs,
    shapes: gpx.shapes,
    stops: gpx.stops,
    cameras: ride.extras?.cameras ?? [],
    origin: originOf(ride),
  };
}

/** The roadbook file of a saved ride, from the GPX input already built for it (one tracing, shared by export and share). */
export function savedRideRoadbook(ride: SavedRide, gpx: GpxInput) {
  return buildRoadbookFile(roadbookInput(ride, gpx), undefined, overpassBuiltUp, configuredSigns());
}

/**
 * The roadbook file a push sends: the line, the waypoints and the cameras, with nothing traced, no land use and no signs asked for.
 * The server takes none of the limits from a file (it traces them on its own map), so doing it here would only be waiting.
 */
export async function pushableRoadbookFile(store: Store, ride: SavedRide): Promise<string> {
  const { gpx } = await savedRideGpx(store, ride);
  const { file } = await buildRoadbookFile(roadbookInput(ride, gpx), async () => {
    throw new Error("not traced: the server does it");
  });
  return JSON.stringify(file);
}

/** The GPX of a saved ride alone: no roadbook file, so nothing traced and no lookups. */
export async function exportSavedRideGpx(
  store: Store,
  ride: SavedRide,
  file?: string,
  maxRoutePoints?: number,
): Promise<{ path: string; rerouted: boolean; stopsAt: Array<{ label: string; index: number; total: number }> }> {
  const { gpx, rerouted } = await savedRideGpx(store, ride);
  const input = { ...gpx, maxRoutePoints };
  return { path: writeGpx(input, ride.id, file), rerouted, stopsAt: routePointIndex(input) };
}

/**
 * Export a saved ride as a GPX file and as a roadbook file for the MobileMotoRide app (limits, cameras).
 * The roadbook file is always written; when Valhalla cannot give the limits it has none and `limitsError` says why.
 */
export async function exportSavedRide(
  store: Store,
  ride: SavedRide,
  file?: string,
  maxRoutePoints?: number,
): Promise<{
  path: string;
  roadbookFile: string;
  limitsError: string | null;
  /** Why built-up areas were not checked, so untagged town roads kept the country default; null when they were. */
  builtUpError: string | null;
  /** Why road signs were not checked (a token is set but the service failed); null when they were or are off. */
  signsError: string | null;
  /** Where a sign says another limit than the one OpenStreetMap posts: OpenStreetMap is kept; the rider may check the sign or fix the map. */
  signLowered: string[];
  signHigher: string[];
  rerouted: boolean;
  stopsAt: Array<{ label: string; index: number; total: number }>;
}> {
  const { gpx, rerouted } = await savedRideGpx(store, ride);
  const input = { ...gpx, maxRoutePoints };
  const path = writeGpx(input, ride.id, file);
  const {
    file: roadbook,
    limitsError,
    builtUpError,
    signsError,
    signLowered,
    signHigher,
  } = await savedRideRoadbook(ride, gpx);
  const roadbookFile = roadbookFilePath(path);
  writeFileSync(roadbookFile, JSON.stringify(roadbook));
  return {
    path,
    roadbookFile,
    limitsError,
    builtUpError,
    signsError,
    signLowered,
    signHigher,
    rerouted,
    stopsAt: routePointIndex(input),
  };
}

/** The line telling where the roadbook file went, and what is missing from it. */
export function describeRoadbookFile(result: {
  roadbookFile: string;
  limitsError: string | null;
  builtUpError?: string | null;
  signsError?: string | null;
  signLowered?: string[];
  signHigher?: string[];
}): string {
  return `Roadbook file (speed limits and cameras, for the MobileMotoRide app): ${result.roadbookFile}${result.limitsError ? `\n(${result.limitsError}; the file has no limits there.)` : ""}${result.builtUpError ? `\n(${result.builtUpError})` : ""}${result.signsError ? `\n(${result.signsError})` : ""}${result.signLowered?.length ? `\nA road sign says a lower limit than OpenStreetMap here and the lower one is in the file (a warning that is early is safe; check the sign, or the map):\n- ${result.signLowered.join("\n- ")}` : ""}${result.signHigher?.length ? `\nA road sign says a higher limit than OpenStreetMap here; OpenStreetMap is kept (a sign never raises a limit):\n- ${result.signHigher.join("\n- ")}` : ""}`;
}

/** "pause: X at route point 18 of 40" lines, for the rider to find the stops in an app's stage list. */
export function describeStopsAt(stopsAt: Array<{ label: string; index: number; total: number }>): string[] {
  return stopsAt.map((s) => `  ${s.label}: route point ${s.index} of ${s.total}`);
}
