import { decodePolyline, encodePolyline, type LatLon } from "../geometry.ts";
import { fetchJson } from "../http.ts";
import { overviewLink, pinnedMapsLinks } from "../maps.ts";
import { bearingDeg, describeCoords, fmtCoords, haversineKm, type Point, resolvePoint } from "./geo.ts";

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

interface TraceEdge {
  length: number;
  speed_limit?: number;
  road_class?: string;
  density?: number;
  names?: string[];
  surface?: string;
  begin_shape_index?: number;
  end_shape_index?: number;
  end_node?: { admin_index?: number };
}

interface TraceAttributesResponse {
  shape?: string;
  admins?: Array<{ country_code?: string; state_code?: string }>;
  edges: TraceEdge[];
}

// Legal default limit (km/h) on a single-carriageway road outside built-up
// areas, used where OpenStreetMap has no limit tagged. Keyed by country, or
// "country-region" where regions differ. Sources: national highway codes.
const RURAL_DEFAULT_KMH: Record<string, number> = {
  "BE-WAL": 90,
  "BE-VLG": 70,
  "BE-BRU": 70,
  FR: 80,
  LU: 90,
  NL: 80,
  DE: 100,
  CH: 80,
  AT: 100,
  IT: 90,
  ES: 90,
  PT: 90,
  GB: 97,
  IE: 80,
  DK: 80,
  SE: 70,
  NO: 80,
  FI: 80,
  PL: 90,
  CZ: 90,
  SK: 90,
  SI: 90,
  HR: 90,
  HU: 90,
};
const UNKNOWN_COUNTRY_DEFAULT_KMH = 80;
// The legal default also applies to farm lanes and estate roads, but nobody
// rides them at 90: cap the assumed speed by road class.
const MINOR_ROAD_CAP_KMH: Record<string, number> = { unclassified: 60, residential: 40, service_other: 30 };
const MAJOR_CLASSES = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

/** Assumed limit for an untagged segment outside built-up areas. */
function ruralDefaultKmh(roadClass: string, admin: { country_code?: string; state_code?: string } | undefined): number {
  const country = admin?.country_code ?? "";
  const legal =
    RURAL_DEFAULT_KMH[`${country}-${admin?.state_code ?? ""}`] ??
    RURAL_DEFAULT_KMH[country] ??
    UNKNOWN_COUNTRY_DEFAULT_KMH;
  if (MAJOR_CLASSES.has(roadClass)) return legal;
  return Math.min(legal, MINOR_ROAD_CAP_KMH[roadClass] ?? 30);
}

// Valhalla density runs 0 (empty country) to 15 (city core). On measured routes,
// roads posted above 50 sit at 2-5 and town streets reach 6 and more.
const BUILT_UP_DENSITY = 6;

/**
 * Share of the legal limit a rider actually averages, from how much the road
 * turns (degrees of heading change per km). Straight road: 95%. Flowing bends
 * (~200): about 80%. Hairpin country (~600): about half.
 */
function bendFactor(turningDegPerKm: number): number {
  return Math.min(0.95, Math.max(0.5, 0.95 - turningDegPerKm / 1400));
}

function turningDegPerKm(
  shape: Array<{ lat: number; lon: number }>,
  from: number,
  to: number,
  lengthKm: number,
): number {
  if (lengthKm <= 0) return 0;
  let turning = 0;
  let previous: number | null = null;
  for (let i = Math.max(from, 0) + 1; i <= to && i < shape.length; i++) {
    const a = shape[i - 1]!;
    const b = shape[i]!;
    if (haversineKm(a, b) === 0) continue;
    const bearing = bearingDeg(a, b);
    if (previous !== null) {
      const delta = Math.abs(bearing - previous);
      turning += Math.min(delta, 360 - delta);
    }
    previous = bearing;
  }
  return turning / lengthKm;
}

const fmtDuration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
};
const avgSpeedKmh = (km: number, seconds: number) => (seconds > 0 ? Math.round(km / (seconds / 3600)) : 0);
const round1 = (n: number) => Number(n.toFixed(1));

/** Resolve an ordered waypoint list, closing the loop when roundTrip is set. */
export async function resolveWaypoints(waypoints: string[], roundTrip = false): Promise<Point[]> {
  if (waypoints.length < 2 && !(roundTrip && waypoints.length === 1)) {
    throw new Error("At least two waypoints are required");
  }
  // The public router takes 10 locations per route, and a loop's return to the start is one.
  if (waypoints.length + (roundTrip ? 1 : 0) > 10) {
    throw new Error(
      `Too many waypoints: ${waypoints.length}${roundTrip ? " plus the return to the start" : ""}; the router takes 10 locations. Keep the ones that shape the loop.`,
    );
  }
  const points: Point[] = [];
  for (const waypoint of waypoints) {
    const point = await resolvePoint(waypoint);
    // A waypoint given as coordinates gets a name a rider can read on the itinerary.
    if (/^-?\d/.test(point.label)) point.label = await describeCoords(point.lat, point.lon);
    points.push(point);
  }
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
        attributes: [
          "edge.length",
          "edge.speed_limit",
          "edge.road_class",
          "edge.density",
          "edge.names",
          "edge.surface",
          "edge.begin_shape_index",
          "edge.end_shape_index",
          "shape",
          "node.admin_index",
          "admin.country_code",
          "admin.state_code",
        ],
        action: "include",
      },
    }),
  });
}

/**
 * The named roads a line of points runs on, longest first, by matching it to
 * the road network: a recorded track, or a stretch of a planned route.
 * Points are thinned to about one every 30 m, which the matcher needs, not more.
 */
export async function roadsAlong(points: LatLon[]): Promise<Array<{ name: string; km: number }>> {
  const thinned: LatLon[] = [];
  for (const p of points) {
    const last = thinned.at(-1);
    if (!last || haversineKm(last, p) >= 0.03) thinned.push(p);
  }
  if (thinned.length < 2) return [];
  const step = Math.ceil(thinned.length / 400);
  const sample = thinned.filter((_, i) => i % step === 0 || i === thinned.length - 1);
  const response = await traceAttributes(encodePolyline(sample), "map_snap");
  const byName = new Map<string, number>();
  for (const edge of response.edges) {
    const name = edge.names?.[0];
    if (name) byName.set(name, (byName.get(name) ?? 0) + edge.length);
  }
  return [...byName].map(([name, km]) => ({ name, km: round1(km) })).sort((a, b) => b.km - a.km);
}

/**
 * Walk every road segment of the routed legs and derive, from OpenStreetMap data:
 * - the speed-limit profile. A segment with no limit tagged counts as a 50 zone
 *   when it lies in a built-up area, and otherwise as open road at the legal
 *   default of its country and region (90 in Wallonia, 70 in Flanders, 80 in France);
 * - a riding-time estimate: limit (or the open-road default for the road class)
 *   scaled down by how much the segment turns. The router's own time assumes
 *   about 50 km/h on roads posted at 80 and is kept only as an upper bound;
 * - the main roads of each leg.
 */
async function profileLegs(legShapes: string[]) {
  let km30 = 0;
  let km50 = 0;
  let km50Assumed = 0;
  let kmFaster = 0;
  let kmOpenUnposted = 0;
  let kmMotorway = 0;
  const zones30 = new Map<string, number>();
  const zones50 = new Map<string, number>();
  const assumedLimits = new Map<number, number>();
  // Rough paved (cobbles, setts) and unpaved stretches, by road and leg.
  const ROUGH = new Set(["paved_rough"]);
  const UNPAVED = new Set(["compacted", "gravel", "dirt", "path", "impassable"]);
  let kmRough = 0;
  let kmUnpaved = 0;
  const badSurface = new Map<string, { road: string; leg: number; surface: string; km: number }>();
  let legIndex = 0;
  const legRoads: string[][] = [];
  const legSeconds: number[] = [];
  // The rider's own yardstick: riding time at an estimated 70 km/h or more.
  let secondsFast = 0;
  let secondsOn70Plus = 0;
  let secondsAll = 0;
  let kmLimit70Plus = 0;

  for (const legShape of legShapes) {
    legIndex++;
    // Exact edge matching is fastest but occasionally fails on a valid route
    // shape; map-snapping the same shape is the tolerant fallback.
    let data: TraceAttributesResponse;
    try {
      data = await traceAttributes(legShape, "edge_walk");
    } catch {
      data = await traceAttributes(legShape, "map_snap");
    }
    // Shape indexes refer to the shape returned with the edges.
    const shape = decodePolyline(data.shape ?? legShape);
    const roadKm = new Map<string, number>();
    let seconds = 0;

    for (const edge of data.edges) {
      const km = edge.length;
      const roadClass = edge.road_class ?? "unclassified";
      const name = edge.names?.join(" / ") ?? "unnamed road";
      // Prefer the road ref ("D 518") over the street name when both are tagged.
      const label = edge.names?.find((n) => /^[A-Z]{1,2} ?\d/.test(n)) ?? edge.names?.[0];
      if (label) roadKm.set(label, (roadKm.get(label) ?? 0) + km);
      if (roadClass === "motorway") kmMotorway += km;
      if (edge.surface && (ROUGH.has(edge.surface) || UNPAVED.has(edge.surface))) {
        if (ROUGH.has(edge.surface)) kmRough += km;
        else kmUnpaved += km;
        const road = edge.names?.join(" / ") ?? "unnamed road";
        const key = `${legIndex}|${road}|${edge.surface}`;
        const entry = badSurface.get(key) ?? { road, leg: legIndex, surface: edge.surface, km: 0 };
        entry.km += km;
        badSurface.set(key, entry);
      }

      const posted = edge.speed_limit && edge.speed_limit > 0 ? edge.speed_limit : undefined;
      const builtUp = (edge.density ?? 0) >= BUILT_UP_DENSITY;
      const rural = ruralDefaultKmh(roadClass, data.admins?.[edge.end_node?.admin_index ?? -1]);
      const limit = posted ?? (builtUp ? Math.min(50, rural) : rural);
      if (posted === undefined && !builtUp && limit > 50) {
        assumedLimits.set(limit, (assumedLimits.get(limit) ?? 0) + km);
      }

      if (limit <= 30) {
        km30 += km;
        zones30.set(name, (zones30.get(name) ?? 0) + km);
      } else if (limit <= 50) {
        km50 += km;
        if (posted === undefined) km50Assumed += km;
        zones50.set(name, (zones50.get(name) ?? 0) + km);
      } else if (posted !== undefined) kmFaster += km;
      else kmOpenUnposted += km;

      const turning = turningDegPerKm(shape, edge.begin_shape_index ?? 0, edge.end_shape_index ?? 0, km);
      // In town, junctions and traffic lights cost more than bends do.
      const factor = limit <= 50 ? Math.min(bendFactor(turning), 0.85) : bendFactor(turning);
      const speed = limit * factor;
      const edgeSeconds = (km / speed) * 3600;
      seconds += edgeSeconds;
      secondsAll += edgeSeconds;
      if (speed >= 70) secondsFast += edgeSeconds;
      if (limit >= 70) {
        kmLimit70Plus += km;
        secondsOn70Plus += edgeSeconds;
      }
    }
    legSeconds.push(seconds);
    legRoads.push(
      [...roadKm.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([road, km]) => `${road} (${round1(km)} km)`),
    );
  }

  const total = km30 + km50 + kmFaster + kmOpenUnposted;
  const pct = (km: number) => (total === 0 ? 0 : round1((km / total) * 100));
  const longest = (zones: Map<string, number>) =>
    [...zones.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([road, km]) => ({ road, km: Number(km.toFixed(2)) }));
  return {
    legRoads,
    legSeconds,
    speedLimits: {
      openRoadPct: pct(kmFaster + kmOpenUnposted - kmMotorway),
      // The rider's yardstick, "most of the time riding at 70 or more", two ways:
      // time on roads where the limit is 70 or more, and time at an estimated 70 or more
      // (which needs a limit of 80 or above, since bends and junctions take a few km/h off).
      timeOnRoads70PlusPct: secondsAll === 0 ? 0 : round1((secondsOn70Plus / secondsAll) * 100),
      timeAbove70EstimatedPct: secondsAll === 0 ? 0 : round1((secondsFast / secondsAll) * 100),
      distanceLimit70PlusPct: pct(kmLimit70Plus),
      limit30OrLess: { km: round1(km30), pct: pct(km30) },
      limit31to50: { km: round1(km50), pct: pct(km50), ofWhichUntaggedBuiltUpKm: round1(km50Assumed) },
      limitAbove50: { km: round1(kmFaster), pct: pct(kmFaster) },
      untaggedOpenRoad: {
        km: round1(kmOpenUnposted),
        pct: pct(kmOpenUnposted),
        // Country and region legal defaults applied to these stretches, by assumed limit.
        assumedLimitsKm: Object.fromEntries(
          [...assumedLimits.entries()].sort((a, b) => b[0] - a[0]).map(([limit, km]) => [`${limit} km/h`, round1(km)]),
        ),
      },
      motorwayKm: round1(kmMotorway),
      longest30Zones: longest(zones30),
      longest50Zones: longest(zones50),
      surface: {
        roughPavedKm: round1(kmRough),
        unpavedKm: round1(kmUnpaved),
        stretches: [...badSurface.values()]
          .sort((a, b) => b.km - a.km)
          .slice(0, 6)
          .map((s) => ({
            ...s,
            km: Number(s.km.toFixed(2)),
            surface: s.surface === "paved_rough" ? "cobbles or setts" : s.surface,
          })),
      },
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
  avgSpeedKmh: number;
  routerMinutes: number;
  usesMotorway: boolean;
  mainRoads: string[];
}

/** A routed trip: what the model sees (`result`) plus the geometry kept for saving and comparing. */
export interface TripComputation {
  result: {
    totalDistanceKm: number;
    totalRidingTime: string;
    totalRidingMinutes: number;
    avgSpeedKmh: number;
    timeBasis: string;
    routerUpperBoundTime: string;
    motorwaysAvoided: boolean;
    usesMotorway: boolean;
    usesTollRoad: boolean;
    speedLimits: SpeedLimits;
    legs: TripLeg[];
    /** Plain link through the waypoints only. */
    mapsUrl: string;
    /** Links with pass-through points that keep Google Maps on the chosen roads; more than one for a long loop. */
    navigationLinks: string[];
  };
  waypoints: string[];
  roundTrip: boolean;
  /** Whether this trip was routed with motorways excluded. */
  avoidMotorways: boolean;
  shapes: string[];
  /** False when the speed-limit lookup failed; such results are not worth caching. */
  complete: boolean;
}

/**
 * Route through the waypoints in order (public Valhalla server, motorcycle
 * profile) and return distance, riding time and the speed-limit profile.
 * Riding time excludes stops.
 */
/** With several navigation links, one more showing the whole ride (not for navigating). */
export function overviewWhenSplit(points: Array<{ lat: number; lon: number }>, shapes: string[], parts = 2) {
  return parts > 1 ? { overviewLink: overviewLink(points, shapes) } : {};
}

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
        // 0 keeps off motorways wherever another road exists; 1 takes them whenever they are faster.
        costing_options: { motorcycle: { use_highways: avoidMotorways ? 0 : 1 } },
        units: "kilometers",
        directions_type: "none",
      }),
    });
  } catch (error) {
    // Show how each waypoint was resolved: a wrong geocoding match is the usual cause.
    const resolved = points.map((p) => `${p.label} (${fmtCoords(p)})`).join(" -> ");
    throw new Error(`${error instanceof Error ? error.message : error}. Waypoints resolved as: ${resolved}`, {
      cause: error,
    });
  }
  const { summary, legs } = data.trip;
  const shapes = legs.map((leg) => leg.shape);

  let speedLimits: SpeedLimits;
  let legRoads: string[][] = [];
  // Until the segment profile succeeds, the router's own (pessimistic) times are all there is.
  let legSeconds = legs.map((leg) => leg.summary.time);
  let complete = true;
  try {
    ({ speedLimits, legRoads, legSeconds } = await profileLegs(shapes));
  } catch (error) {
    complete = false;
    speedLimits = {
      unavailable: `Speed-limit data could not be fetched (${error instanceof Error ? error.message.slice(0, 120) : error}). Slow-zone share is unverified for this route.`,
    };
  }
  const totalSeconds = legSeconds.reduce((sum, seconds) => sum + seconds, 0);

  return {
    waypoints: input.waypoints,
    roundTrip: input.roundTrip ?? false,
    avoidMotorways,
    shapes,
    complete,
    result: {
      totalDistanceKm: round1(summary.length),
      totalRidingTime: fmtDuration(totalSeconds),
      totalRidingMinutes: Math.round(totalSeconds / 60),
      avgSpeedKmh: avgSpeedKmh(summary.length, totalSeconds),
      timeBasis: complete
        ? "estimated from speed limits and bends per road segment, without traffic or stops"
        : "router estimate only (speed-limit data unavailable); pessimistic, real riding is usually faster",
      routerUpperBoundTime: fmtDuration(summary.time),
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
        ridingMinutes: Math.round(legSeconds[i]! / 60),
        ridingTime: fmtDuration(legSeconds[i]!),
        avgSpeedKmh: avgSpeedKmh(leg.summary.length, legSeconds[i]!),
        routerMinutes: Math.round(leg.summary.time / 60),
        usesMotorway: leg.summary.has_highway,
        mainRoads: legRoads[i] ?? [],
      })),
      mapsUrl: `https://www.google.com/maps/dir/${points.map(fmtCoords).join("/")}`,
      navigationLinks: pinnedMapsLinks(points, shapes),
      ...overviewWhenSplit(points, shapes, pinnedMapsLinks(points, shapes).length),
    },
  };
}

export async function calculateTrip(input: CalculateTripInput) {
  return (await computeTrip(input)).result;
}
