import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePolyline, routeCells } from "./geometry.ts";
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
}

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const point = (coords: string) => {
  const [lat = "0", lon = "0"] = coords.split(",");
  return `lat="${Number(lat).toFixed(6)}" lon="${Number(lon).toFixed(6)}"`;
};

/**
 * GPX 1.1 with three views of the same ride, so any app finds what it reads:
 * - waypoints: the start and each stop;
 * - a route through those stops, for apps that compute their own way between them;
 * - a track with the exact road geometry, one segment per leg, for apps that
 *   follow a line. The track is the one that keeps the ride on the chosen roads.
 */
export function buildGpx(input: GpxInput): string {
  const stops = [
    { coords: input.legs[0]!.fromCoords, name: `Start: ${input.legs[0]!.from}` },
    ...input.legs.map((leg, i) => ({
      coords: leg.toCoords,
      name: i === input.legs.length - 1 ? `Finish: ${leg.to}` : `${i + 1}. ${leg.to}`,
    })),
  ];
  const waypoints = stops.map((s) => `  <wpt ${point(s.coords)}><name>${xml(s.name)}</name></wpt>`);
  const routePoints = stops.map((s) => `    <rtept ${point(s.coords)}><name>${xml(s.name)}</name></rtept>`);
  const segments = input.shapes.map((shape, i) => {
    const leg = input.legs[i];
    const comment = leg ? `    <!-- leg ${i + 1}: ${xml(leg.from)} to ${xml(leg.to)} -->\n` : "";
    const points = decodePolyline(shape).map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`);
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
    <name>${xml(input.name)} (stops)</name>
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
 * Export a saved ride. Rides saved before route lines were stored are routed
 * again from their waypoints, and the line is then kept for next time.
 */
export async function exportSavedRide(store: Store, ride: SavedRide, file?: string): Promise<{ path: string; rerouted: boolean }> {
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
  const path = writeGpx(
    {
      name: ride.name,
      description: `${ride.distanceKm} km, about ${hours} riding. Planned with agentRide from ${ride.home}.`,
      legs,
      shapes,
    },
    ride.id,
    file,
  );
  return { path, rerouted };
}
