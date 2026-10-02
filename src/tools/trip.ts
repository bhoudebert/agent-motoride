import { fetchJson } from "../http.ts";
import { fmtCoords, resolvePoint, type Point } from "./geo.ts";

export interface CalculateTripInput {
  waypoints: string[];
  roundTrip?: boolean;
  avoidMotorways?: boolean;
}

const VALHALLA = "https://valhalla1.openstreetmap.de";

interface ValhallaResponse {
  trip: {
    summary: { length: number; time: number };
    legs: Array<{
      shape: string;
      summary: { length: number; time: number; has_highway: boolean; has_toll: boolean };
    }>;
  };
}

interface TraceAttributesResponse {
  edges: Array<{ length: number; speed_limit?: number; road_class?: string; names?: string[] }>;
}

const fmtDuration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
};
const round1 = (n: number) => Number(n.toFixed(1));

/** Resolve an ordered waypoint list, closing the loop when roundTrip is set. */
export async function resolveWaypoints(waypoints: string[], roundTrip = false): Promise<Point[]> {
  if (waypoints.length < 2 && !(roundTrip && waypoints.length === 1)) {
    throw new Error("At least two waypoints are required");
  }
  const points: Point[] = [];
  for (const waypoint of waypoints) points.push(await resolvePoint(waypoint));
  if (roundTrip) points.push(points[0]!);
  return points;
}

function traceAttributes(shape: string, shapeMatch: "edge_walk" | "map_snap") {
  return fetchJson<TraceAttributesResponse>(`${VALHALLA}/trace_attributes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encoded_polyline: shape,
      shape_match: shapeMatch,
      costing: "motorcycle",
      filters: {
        attributes: ["edge.length", "edge.speed_limit", "edge.road_class", "edge.names"],
        action: "include",
      },
    }),
  });
}

/**
 * Posted speed limits along the routed legs, from OpenStreetMap maxspeed tags,
 * plus the main roads of each leg. Segments without a tag are counted as
 * "unposted": outside towns that normally means the national default applies,
 * so they are not slow zones.
 */
async function profileLegs(legShapes: string[]) {
  let km30 = 0;
  let km50 = 0;
  let kmFaster = 0;
  let kmUnposted = 0;
  let kmMotorway = 0;
  const zones30 = new Map<string, number>();
  const legRoads: string[][] = [];

  for (const shape of legShapes) {
    // Exact edge matching is fastest but occasionally fails on a valid route
    // shape; map-snapping the same shape is the tolerant fallback.
    let data: TraceAttributesResponse;
    try {
      data = await traceAttributes(shape, "edge_walk");
    } catch {
      data = await traceAttributes(shape, "map_snap");
    }
    const roadKm = new Map<string, number>();
    for (const edge of data.edges) {
      if (edge.road_class === "motorway") kmMotorway += edge.length;
      // Prefer the road ref ("D 518") over the street name when both are tagged.
      const label = edge.names?.find((n) => /^[A-Z]{1,2} ?\d/.test(n)) ?? edge.names?.[0];
      if (label) roadKm.set(label, (roadKm.get(label) ?? 0) + edge.length);
      const limit = edge.speed_limit;
      if (limit === undefined || limit === 0) kmUnposted += edge.length;
      else if (limit <= 30) {
        km30 += edge.length;
        const name = edge.names?.join(" / ") ?? "unnamed road";
        zones30.set(name, (zones30.get(name) ?? 0) + edge.length);
      } else if (limit <= 50) km50 += edge.length;
      else kmFaster += edge.length;
    }
    legRoads.push(
      [...roadKm.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([road, km]) => `${road} (${round1(km)} km)`),
    );
  }

  const total = km30 + km50 + kmFaster + kmUnposted;
  const pct = (km: number) => (total === 0 ? 0 : round1((km / total) * 100));
  return {
    legRoads,
    speedLimits: {
      limit30OrLess: { km: round1(km30), pct: pct(km30) },
      limit31to50: { km: round1(km50), pct: pct(km50) },
      limitAbove50: { km: round1(kmFaster), pct: pct(kmFaster) },
      unposted: { km: round1(kmUnposted), pct: pct(kmUnposted) },
      motorwayKm: round1(kmMotorway),
      longest30Zones: [...zones30.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([road, km]) => ({ road, km: Number(km.toFixed(2)) })),
    },
  };
}

type SpeedLimits = Awaited<ReturnType<typeof profileLegs>>["speedLimits"] | { unavailable: string };

export interface TripLeg {
  from: string;
  to: string;
  fromCoords: string;
  toCoords: string;
  distanceKm: number;
  ridingMinutes: number;
  ridingTime: string;
  usesMotorway: boolean;
  mainRoads: string[];
}

/** A routed trip: what the model sees (`result`) plus the geometry kept for saving and comparing. */
export interface TripComputation {
  result: {
    totalDistanceKm: number;
    totalRidingTime: string;
    totalRidingMinutes: number;
    motorwaysAvoided: boolean;
    usesMotorway: boolean;
    usesTollRoad: boolean;
    speedLimits: SpeedLimits;
    legs: TripLeg[];
    mapsUrl: string;
  };
  waypoints: string[];
  roundTrip: boolean;
  shapes: string[];
  /** False when the speed-limit lookup failed; such results are not worth caching. */
  complete: boolean;
}

/**
 * Route through the waypoints in order (public Valhalla server, motorcycle
 * profile) and return distance, riding time and the speed-limit profile.
 * Riding time excludes stops.
 */
export async function computeTrip(input: CalculateTripInput): Promise<TripComputation> {
  const points = await resolveWaypoints(input.waypoints, input.roundTrip);
  const avoidMotorways = input.avoidMotorways ?? true;
  let data: ValhallaResponse;
  try {
    data = await fetchJson<ValhallaResponse>(`${VALHALLA}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: points.map((p) => ({ lat: p.lat, lon: p.lon })),
        costing: "motorcycle",
        costing_options: { motorcycle: { use_highways: avoidMotorways ? 0 : 0.5 } },
        units: "kilometers",
        directions_type: "none",
      }),
    });
  } catch (error) {
    // Show how each waypoint was resolved: a wrong geocoding match is the usual cause.
    const resolved = points.map((p) => `${p.label} (${fmtCoords(p)})`).join(" -> ");
    throw new Error(`${error instanceof Error ? error.message : error}. Waypoints resolved as: ${resolved}`);
  }
  const { summary, legs } = data.trip;
  const shapes = legs.map((leg) => leg.shape);

  let speedLimits: SpeedLimits;
  let legRoads: string[][] = [];
  let complete = true;
  try {
    ({ speedLimits, legRoads } = await profileLegs(shapes));
  } catch (error) {
    complete = false;
    speedLimits = {
      unavailable: `Speed-limit data could not be fetched (${error instanceof Error ? error.message.slice(0, 120) : error}). Slow-zone share is unverified for this route.`,
    };
  }

  return {
    waypoints: input.waypoints,
    roundTrip: input.roundTrip ?? false,
    shapes,
    complete,
    result: {
      totalDistanceKm: round1(summary.length),
      totalRidingTime: fmtDuration(summary.time),
      totalRidingMinutes: Math.round(summary.time / 60),
      motorwaysAvoided: avoidMotorways,
      usesMotorway: legs.some((leg) => leg.summary.has_highway),
      usesTollRoad: legs.some((leg) => leg.summary.has_toll),
      speedLimits,
      legs: legs.map((leg, i) => ({
        from: points[i]!.label,
        to: points[i + 1]!.label,
        fromCoords: fmtCoords(points[i]!),
        toCoords: fmtCoords(points[i + 1]!),
        distanceKm: round1(leg.summary.length),
        ridingMinutes: Math.round(leg.summary.time / 60),
        ridingTime: fmtDuration(leg.summary.time),
        usesMotorway: leg.summary.has_highway,
        mainRoads: legRoads[i] ?? [],
      })),
      mapsUrl: `https://www.google.com/maps/dir/${points.map(fmtCoords).join("/")}`,
    },
  };
}

export async function calculateTrip(input: CalculateTripInput) {
  return (await computeTrip(input)).result;
}
