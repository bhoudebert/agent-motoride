import type { CurrentRide } from "./agent.ts";
import { centroid, decodePolyline } from "./geometry.ts";
import { describeStopsAt, routePointIndex } from "./gpx.ts";
import { type MapsLink, pinnedMapsParts } from "./maps.ts";
import { duplicateOf, type RideContext } from "./session.ts";
import { analyseConditions, windAlong, type RideConditions } from "./conditions.ts";
import { formatStopPlan, locateStops, planStops, type StopCandidate } from "./stops.ts";
import type { NewRide, RideExtras, RideWeather, SavedRide, Store } from "./store.ts";
import { type StopKind, speedCamerasAlong, stopsAlong } from "./tools/along.ts";
import { haversineKm, setGeoAnchor } from "./tools/geo.ts";
import type { TripComputation } from "./tools/trip.ts";
import { getDaylight, getWeather, utcOffsetSecondsOn } from "./tools/weather.ts";
import { formatUsage, type RunUsage } from "./usage.ts";

const fmtMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
const stars = (rating: number | null) =>
  rating === null ? "unrated" : rating === 0 ? "✗ never again" : `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`;

/** The stored figures derived from a routed trip. */
export function tripFigures(trip: TripComputation, cells: string[]) {
  const centre = centroid(trip.shapes.flatMap((shape) => decodePolyline(shape)));
  return {
    distanceKm: trip.result.totalDistanceKm,
    ridingMinutes: trip.result.totalRidingMinutes,
    speedLimits: trip.result.speedLimits,
    mapsUrl: trip.result.mapsUrl,
    cells,
    shapes: trip.shapes,
    centerLat: centre.lat,
    centerLon: centre.lon,
    legs: trip.result.legs.map((leg, i) => ({
      seq: i + 1,
      from: leg.from,
      to: leg.to,
      fromCoords: leg.fromCoords,
      toCoords: leg.toCoords,
      distanceKm: leg.distanceKm,
      ridingMinutes: leg.ridingMinutes,
      mainRoads: leg.mainRoads,
    })),
  } satisfies Partial<NewRide>;
}

export class DuplicateRideError extends Error {
  readonly duplicate: { rideId: number; name: string; overlapPct: number };
  constructor(duplicate: { rideId: number; name: string; overlapPct: number }) {
    super(
      `This ride is ${duplicate.overlapPct}% the same roads as saved ride #${duplicate.rideId} "${duplicate.name}". Not saved. Rate or edit that ride instead, or force the save if it is meant as a copy.`,
    );
    this.duplicate = duplicate;
  }
}

/** Store the current itinerary and its routed trip. Returns the new ride id. */
export function saveCurrentRide(
  context: RideContext,
  ride: CurrentRide,
  options: { name?: string; request: string; parentId: number | null; home: string; usage?: RunUsage; force?: boolean },
): number {
  const { trip, cells } = ride.route;
  // The library exists so that rides differ; a copy of a saved ride is refused unless forced.
  const duplicate = duplicateOf(context, cells);
  if (duplicate && !options.force) {
    throw new DuplicateRideError(duplicate);
  }
  const id = context.store.saveRide({
    name: options.name?.trim() || ride.title,
    parentId: options.parentId,
    home: options.home,
    rideDate: ride.rideDate,
    departure: ride.departure,
    waypoints: trip.waypoints,
    roundTrip: trip.roundTrip,
    // Record how this trip was actually routed, which a later refresh must reproduce.
    preferences: { ...context.preferences, avoidMotorways: trip.avoidMotorways },
    request: options.request,
    itinerary: ride.itinerary,
    usage: options.usage ?? null,
    extras: null,
    ...tripFigures(trip, cells),
  });
  // Later versions in this session should not be rejected for resembling this one.
  context.lineage.add(id);
  return id;
}

/** One line on where the ride's distance is spent, when the profile was recorded. */
function formatRoadMix(ride: SavedRide): string | null {
  const s = ride.speedLimits as {
    openRoadPct?: number;
    limit30OrLess?: { pct: number };
    limit31to50?: { pct: number };
    untaggedOpenRoad?: { pct: number };
    timeOnRoads70PlusPct?: number;
    timeAbove70EstimatedPct?: number;
    motorwayKm?: number;
  } | null;
  if (!s?.limit30OrLess || !s.limit31to50) return null;
  const open = s.openRoadPct ?? Number((100 - s.limit30OrLess.pct - s.limit31to50.pct).toFixed(1));
  const untagged = s.untaggedOpenRoad
    ? ` (${s.untaggedOpenRoad.pct}% with no tagged limit, legal default assumed)`
    : "";
  const motorway = ride.preferences.avoidMotorways ? "" : "  (motorways were allowed)";
  const fast =
    s.timeOnRoads70PlusPct === undefined
      ? ""
      : `  |  ${s.timeOnRoads70PlusPct}% of time on 70+ roads (${s.timeAbove70EstimatedPct}% at 70+ estimated)`;
  return `Road mix: ${open}% open road${untagged}${motorway}${fast}  |  ${s.limit31to50.pct}% in 31-50 zones  |  ${s.limit30OrLess.pct}% in zones of 30 or less  |  motorway ${s.motorwayKm ?? 0} km`;
}

export function formatRideLine(ride: SavedRide): string {
  const parent = ride.parentId ? ` (from #${ride.parentId})` : "";
  return `#${ride.id}  ${ride.name}${parent}  |  ${ride.distanceKm} km, ${fmtMinutes(ride.ridingMinutes)}, ${avgSpeed(ride.distanceKm, ride.ridingMinutes)}  |  ${ride.rideDate ?? "no date"}  |  from ${ride.home}  |  ${stars(ride.rating)}`;
}

export function formatRideList(rides: SavedRide[]): string {
  return rides.length === 0 ? "No saved rides yet." : rides.map(formatRideLine).join("\n");
}

const avgSpeed = (km: number, minutes: number) => (minutes > 0 ? `${Math.round(km / (minutes / 60))} km/h` : "-");

/** "Grenoble, Rhône-Alpes, France" -> "Grenoble"; coordinates are kept whole. */
const shortPlace = (label: string) => (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(label) ? label : label.split(",")[0]!);

/** Legs as an aligned table: distance, riding time and average speed, then a total row. */
function formatLegs(ride: SavedRide): string[] {
  const names = ride.legs.map((leg) => `${leg.seq}. ${shortPlace(leg.from)} -> ${shortPlace(leg.to)}`);
  const width = Math.max(...names.map((n) => n.length), "Total".length);
  const row = (name: string, km: number, minutes: number, extra = "") =>
    `  ${name.padEnd(width)}  ${km.toFixed(1).padStart(6)} km  ${fmtMinutes(minutes).padStart(5)}  ${avgSpeed(km, minutes).padStart(8)}${extra}`;

  const lines = [`  ${"".padEnd(width)}  ${"dist".padStart(9)}  ${"time".padStart(5)}  ${"avg".padStart(8)}`];
  ride.legs.forEach((leg, i) => {
    lines.push(row(names[i]!, leg.distanceKm, leg.ridingMinutes, leg.rating === null ? "" : `  ${stars(leg.rating)}`));
    lines.push(`     ${leg.mainRoads.join(", ") || "roads not recorded"}`);
    if (leg.notes) lines.push(`     note: ${leg.notes}`);
  });
  lines.push(`  ${"-".repeat(width + 30)}`);
  lines.push(row("Total", ride.distanceKm, ride.ridingMinutes));
  return lines;
}

export function formatRideDetail(ride: SavedRide): string {
  return [
    formatRideLine(ride),
    `Saved ${ride.createdAt.slice(0, 10)}, departure ${ride.departure ?? "not set"}`,
    ride.notes ? `Note: ${ride.notes}` : null,
    `Request: ${ride.request}`,
    ...navigationLines(ride),
    formatRoadMix(ride),
    formatSurface(ride),
    ride.usage ? `Planned with: ${formatUsage(ride.usage)}` : null,
    ...formatExtras(ride),
    "",
    "Legs (estimated riding time from speed limits and bends; no stops, no traffic):",
    ...formatLegs(ride),
    "",
    ride.itinerary,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Parse "<1-5> [note]". */
export function parseRating(args: string[]): { rating: number; notes: string | null } {
  const rating = Number(args[0]);
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw new Error(`Rating must be a whole number from 0 (never again) to 5, got "${args[0] ?? ""}".`);
  }
  return { rating, notes: args.slice(1).join(" ").trim() || null };
}

const DAY = 24 * 3_600_000;
const geometryKey = (shapes: string[]) =>
  `${shapes.join("").length}:${shapes.map((sh) => sh.slice(0, 24) + sh.slice(-24)).join("|")}`;

/**
 * Fuel, café, bakery and restaurant candidates along a route, cached 30 days
 * by the route geometry: the slow map lookup happens once per route, and a
 * stop plan can be rebuilt instantly after a profile change.
 */
export async function stopCandidatesFor(
  store: Store,
  shapes: string[],
  legs: Parameters<typeof stopsAlong>[1],
  radiusM = 400,
) {
  const kinds: StopKind[] = ["fuel", "cafe", "bakery", "restaurant"];
  const key = `stopCandidates@6|${radiusM}|${geometryKey(shapes)}`;
  type Lists = Record<string, { stops: StopCandidate[] }>;
  const hit = store.cacheGet<Lists>(key);
  const found = hit ?? ((await stopsAlong(shapes, legs, kinds, radiusM, 40)) as unknown as Lists);
  if (!hit) store.cacheSet(key, "findStops", found, 30 * DAY);
  return {
    fuel: found.fuel?.stops ?? [],
    cafe: found.cafe?.stops ?? [],
    bakery: found.bakery?.stops ?? [],
    restaurant: found.restaurant?.stops ?? [],
  };
}

/** Rebuild only the stop plan of a saved ride from the current profile, using cached candidates when present. */
export async function replanStops(store: Store, ride: SavedRide): Promise<RideExtras | null> {
  if (!ride.shapes) return null;
  await setGeoAnchor(ride.home);
  const legs = ride.legs.map((leg) => ({
    from: leg.from,
    to: leg.to,
    fromCoords: leg.fromCoords,
    toCoords: leg.toCoords,
    distanceKm: leg.distanceKm,
    ridingMinutes: leg.ridingMinutes,
    ridingTime: "",
    avgSpeedKmh: 0,
    routerMinutes: 0,
    usesMotorway: false,
    mainRoads: leg.mainRoads,
  }));
  const candidates = await stopCandidatesFor(store, ride.shapes, legs);
  const stopPlan = await locateStops(
    planStops(legs, candidates, store.getProfile(), ride.departure ?? "09:00", undefined, ride.rideDate),
  );
  const extras: RideExtras = {
    gatheredAt: ride.extras?.gatheredAt ?? new Date().toISOString(),
    daylight: ride.extras?.daylight ?? null,
    cameras: ride.extras?.cameras ?? [],
    stops: {
      fuel: candidates.fuel.slice(0, 10).map((s) => ({
        kmAlongRoute: s.kmAlongRoute,
        leg: s.leg,
        name: s.name,
        openingHours: s.openingHours,
        detourM: s.detourM,
      })),
      cafe: candidates.cafe.slice(0, 10).map((s) => ({
        kmAlongRoute: s.kmAlongRoute,
        leg: s.leg,
        name: s.name,
        openingHours: s.openingHours,
        detourM: s.detourM,
      })),
    },
    errors: { ...(ride.extras?.errors ?? {}) },
    weather: ride.extras?.weather ?? null,
    stopPlan,
  };
  delete extras.errors.stops;
  store.setExtras(ride.id, extras);
  return extras;
}

/**
 * Gather daylight, fixed cameras and stops for a saved ride and store them, so
 * the ride view shows them without any planning session. Lookups are cached,
 * so right after a plan this is nearly free. Failures leave the ride as it is.
 */
export async function enrichRide(store: Store, ride: SavedRide): Promise<RideExtras | null> {
  const shapes = ride.shapes;
  if (!shapes) return null;
  await setGeoAnchor(ride.home);
  const legs = ride.legs.map((leg) => ({
    from: leg.from,
    to: leg.to,
    fromCoords: leg.fromCoords,
    toCoords: leg.toCoords,
    distanceKm: leg.distanceKm,
    ridingMinutes: leg.ridingMinutes,
    ridingTime: "",
    avgSpeedKmh: 0,
    routerMinutes: 0,
    usesMotorway: false,
    mainRoads: leg.mainRoads,
  }));
  const errors: Record<string, string> = {};
  const settle = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (error) {
      errors[name] = (error instanceof Error ? error.message : String(error)).slice(0, 200);
      return null;
    }
  };
  // Cameras and stops both go to the OpenStreetMap query server, one at a time
  // (the server rejects parallel requests from one client), so they run in sequence.
  const daylight = ride.rideDate
    ? await settle("daylight", () => getDaylight({ location: ride.home, date: ride.rideDate! }))
    : null;
  const weather = ride.rideDate ? await settle("weather", () => rideWeather(ride, shapes)) : null;
  const conditions = ride.rideDate ? await settle("conditions", () => rideConditions(ride)) : null;
  const cameras = await settle("cameras", () => speedCamerasAlong(shapes, legs));
  const candidates = await settle("stops", () => stopCandidatesFor(store, shapes, legs));
  const stopPlan = candidates
    ? await locateStops(
        planStops(legs, candidates, store.getProfile(), ride.departure ?? "09:00", undefined, ride.rideDate),
      )
    : null;
  // The view lists the shortlist of fuel and cafés; the plan holds the chosen ones.
  const stops = candidates && {
    fuel: { stops: candidates.fuel.slice(0, 10) },
    cafe: { stops: candidates.cafe.slice(0, 10) },
  };
  // A lookup that failed keeps what the last successful one found.
  const previous = ride.extras;
  const extras: RideExtras = {
    gatheredAt: new Date().toISOString(),
    daylight: daylight
      ? {
          sunrise: daylight.sunrise,
          sunset: daylight.sunset,
          firstLight: daylight.firstLight,
          lastLight: daylight.lastLight,
          daylightHours: daylight.daylightHours,
        }
      : errors.daylight
        ? (previous?.daylight ?? null)
        : null,
    cameras: cameras
      ? cameras.cameras.map((c) => ({
          kmAlongRoute: c.kmAlongRoute,
          leg: c.leg,
          limitKmh: c.limitKmh,
          direction: c.direction,
          coords: c.coords,
        }))
      : (previous?.cameras ?? []),
    stops:
      stops === null
        ? (previous?.stops ?? {})
        : Object.fromEntries(
            Object.entries(stops).map(([key, value]) => [
              key,
              value.stops.map((s) => ({
                kmAlongRoute: s.kmAlongRoute,
                leg: s.leg,
                name: s.name,
                openingHours: s.openingHours,
                detourM: s.detourM,
              })),
            ]),
          ),
    errors,
    // A date beyond the forecast range keeps the last forecast gathered, if any.
    weather: weather ?? (errors.weather ? (previous?.weather ?? null) : null),
    stopPlan: stopPlan ?? previous?.stopPlan ?? null,
    conditions: conditions ?? previous?.conditions ?? null,
  };
  store.setExtras(ride.id, extras);
  return extras;
}

/** Daylight, cameras and stops of a saved ride, for the ride view. */
export function formatExtras(ride: SavedRide): string[] {
  const x = ride.extras;
  if (!x) return ["Daylight, cameras and stops: not gathered yet (npm run rides -- refresh " + ride.id + ")"];
  const lines: string[] = [];
  if (x.daylight) {
    lines.push(
      `Daylight on ${ride.rideDate}: sunrise ${x.daylight.sunrise}, sunset ${x.daylight.sunset}, usable light ${x.daylight.firstLight} to ${x.daylight.lastLight} (${x.daylight.daylightHours} h)`,
    );
  }
  lines.push(...formatWeather(x.weather, ride.rideDate));
  if (x.conditions) lines.push(...x.conditions.summary.map((l) => `Conditions: ${l}`));
  if (x.stopPlan) {
    lines.push(...formatStopPlan(x.stopPlan, ride.departure ?? "09:00", ride.ridingMinutes));
    const at = gpxStopsAt(ride);
    if (at.length) lines.push("  in the GPX route (for apps that list stages):", ...describeStopsAt(at));
  }
  lines.push(
    x.cameras.length === 0
      ? "Fixed cameras: none mapped on the route"
      : `Fixed cameras (${x.cameras.length}): ${x.cameras.map((c) => `km ${c.kmAlongRoute} leg ${c.leg}${c.limitKmh ? ` @${c.limitKmh}` : ""}`).join(", ")}`,
  );
  for (const [kind, value] of Object.entries(x.stops)) {
    // Older stored rides keep { stops: [...] } per kind instead of a bare array.
    const stops = Array.isArray(value) ? value : ((value as { stops?: typeof value }).stops ?? []);
    if (!Array.isArray(stops) || stops.length === 0) continue;
    lines.push(
      `${kind[0]!.toUpperCase()}${kind.slice(1)} stops: ${stops.map((s) => `${s.name} (km ${s.kmAlongRoute}${s.openingHours ? `, ${s.openingHours}` : ""})`).join("; ")}`,
    );
  }
  for (const [name, reason] of Object.entries(x.errors ?? {})) {
    const kept =
      name === "cameras"
        ? x.cameras.length > 0
        : name === "stops"
          ? Object.keys(x.stops).length > 0
          : x.daylight !== null;
    lines.push(
      `${name[0]!.toUpperCase()}${name.slice(1)}: last lookup failed (${reason.split(".")[0]})${kept ? ", showing the previous result" : ""}. Run: npm run rides -- refresh ${ride.id}`,
    );
  }
  return lines;
}

/** Fetch the ride's forecast now and store it on the ride. */
export async function rideWeatherFor(store: Store, ride: SavedRide): Promise<RideWeather | null> {
  if (!ride.shapes) return null;
  const weather = await rideWeather(ride, ride.shapes);
  if (weather && ride.extras) store.setExtras(ride.id, { ...ride.extras, weather });
  return weather;
}

/**
 * Forecast for the ride date at the start, a point a third of the way, two
 * thirds of the way, and the end, for the hours the rider would be there.
 * Returns null, without error, when the date is beyond the forecast range.
 */
async function rideWeather(ride: SavedRide, shapes: string[]): Promise<RideWeather | null> {
  const date = ride.rideDate!;
  const daysAhead = (Date.parse(date) - Date.now()) / 86_400_000;
  if (daysAhead > 15 || daysAhead < -1) return null;
  const departure = ride.departure ?? "09:00";
  const startHour = Number(departure.split(":")[0]) || 9;
  const endHour = Math.min(23, startHour + Math.ceil(ride.ridingMinutes / 60) + 1);
  const line = shapes.flatMap((shape) => decodePolyline(shape));
  const cumulative: number[] = [0];
  for (let i = 1; i < line.length; i++) cumulative.push(cumulative[i - 1]! + haversineKm(line[i - 1]!, line[i]!));
  const total = cumulative.at(-1) ?? 0;
  const at = (fraction: number) => {
    const target = total * fraction;
    const index = cumulative.findIndex((km) => km >= target);
    return { point: line[Math.max(0, index)]!, km: Number(target.toFixed(0)) };
  };
  const samples = [
    { label: "start", ...at(0), from: startHour, to: startHour + 1 },
    {
      label: "one third",
      ...at(1 / 3),
      from: startHour + Math.round((endHour - startHour) / 3) - 1,
      to: startHour + Math.round((endHour - startHour) / 3) + 1,
    },
    {
      label: "two thirds",
      ...at(2 / 3),
      from: startHour + Math.round((2 * (endHour - startHour)) / 3) - 1,
      to: startHour + Math.round((2 * (endHour - startHour)) / 3) + 1,
    },
    { label: "finish", ...at(1), from: endHour - 1, to: endHour },
  ];
  const points: RideWeather["points"] = [];
  for (const sample of samples) {
    const w = await getWeather({
      location: `${sample.point.lat},${sample.point.lon}`,
      date,
      fromHour: Math.max(0, sample.from),
      toHour: Math.min(23, sample.to),
    });
    const skies = [...new Set(w.hours.map((h) => h.sky))].join(", ");
    points.push({ label: sample.label, kmAlongRoute: sample.km, ...w.summary, sky: skies });
  }
  return {
    forecastDate: date,
    gatheredAt: new Date().toISOString(),
    window: `${String(startHour).padStart(2, "0")}:00-${String(endHour).padStart(2, "0")}:00`,
    points,
  };
}

/** One line per sampled point of the stored forecast. */
export function formatWeather(weather: RideWeather | null | undefined, rideDate: string | null): string[] {
  if (!weather)
    return rideDate ? ["Weather: no forecast stored (date beyond the 16-day range at the last refresh)"] : [];
  const age = Math.round((Date.now() - Date.parse(weather.gatheredAt)) / 3_600_000);
  const lines = [
    `Weather for ${weather.forecastDate}, ${weather.window}, forecast as of ${weather.gatheredAt.slice(0, 16).replace("T", " ")} (${age} h ago):`,
  ];
  for (const p of weather.points) {
    lines.push(
      `  ${p.label.padEnd(10)} km ${String(p.kmAlongRoute).padStart(3)}  ${p.dry ? "dry" : "RAIN RISK"}, rain ${p.maxRainProbPct}% / ${p.totalRainMm} mm, ${p.minTempC}-${p.maxTempC} °C, gusts ${p.maxGustKmh} km/h, ${p.sky}`,
    );
  }
  return lines;
}

/** Points of a saved ride for the map links: waypoints, and the planned stops when any. */
export function rideNavigation(ride: SavedRide): {
  links: string[];
  parts: MapsLink[];
  stops: Array<{ lat: number; lon: number; label: string; km: number }>;
} {
  const waypoints = [ride.legs[0], ...ride.legs].flatMap((leg, i) => {
    if (!leg) return [];
    const [lat = 0, lon = 0] = (i === 0 ? leg.fromCoords : leg.toCoords).split(",").map(Number);
    return [{ lat, lon }];
  });
  const stops = (ride.extras?.stopPlan?.stops ?? []).map((s) => {
    const [lat = 0, lon = 0] = s.coords.split(",").map(Number);
    return { lat, lon, label: `${s.kind}: ${s.name}`, km: s.kmAlongRoute };
  });
  const parts = ride.shapes ? pinnedMapsParts(waypoints, ride.shapes, stops) : [];
  const links = parts.length ? parts.map((p) => p.url) : [ride.mapsUrl];
  return { links, parts, stops };
}

/** "part 1 ends at km 103, pause: Les Secrets du sucré" for each boundary between parts. */
export function describeParts(parts: MapsLink[], ride: SavedRide): string[] {
  const legName = (p: MapsLink["to"]) => {
    const leg = ride.legs.find((l) => l.toCoords === `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`);
    return leg ? `end of leg ${leg.seq}, ${leg.to}` : "a point on the route";
  };
  return parts.slice(0, -1).map((part, i) => {
    const to = part.to;
    const where =
      to.kind === "stop"
        ? to.label
        : to.kind === "waypoint"
          ? legName(to)
          : `a pass-through point at km ${to.km.toFixed(0)}`;
    return `  part ${i + 1} ends at km ${to.km.toFixed(0)}, ${where}: open part ${i + 2} there`;
  });
}

function navigationLines(ride: SavedRide): string[] {
  const { links, parts, stops } = rideNavigation(ride);
  if (links.length === 1) return [`Map: ${links[0]}${stops.length ? ` (with ${stops.length} stops)` : ""}`];
  return [
    ...links.map((link, i) => `Map part ${i + 1}/${links.length}: ${link}`),
    ...describeParts(parts, ride),
    stops.length
      ? `(links carry the ${stops.length} planned stops and pass-through points that keep Google on the chosen roads)`
      : "(pass-through points keep Google on the chosen roads)",
  ];
}

/** Where the planned stops land in the GPX route point list of a saved ride. */
export function gpxStopsAt(ride: SavedRide) {
  if (!ride.shapes || !ride.extras?.stopPlan?.stops.length) return [];
  const stops = ride.extras.stopPlan.stops.map((s) => {
    const [lat = 0, lon = 0] = s.coords.split(",").map(Number);
    return { lat, lon, label: `${s.kind}: ${s.name} (${s.eta})`, km: s.kmAlongRoute };
  });
  return routePointIndex({ name: ride.name, description: "", legs: ride.legs, shapes: ride.shapes, stops });
}

/** Crosswind (when the date is in forecast range) and low sun for a saved ride. */
export async function rideConditions(ride: SavedRide): Promise<RideConditions | null> {
  if (!ride.shapes || !ride.rideDate) return null;
  const daysAhead = (Date.parse(ride.rideDate) - Date.now()) / 86_400_000;
  const wind = daysAhead <= 15 && daysAhead >= -1 ? await windAlong(ride.shapes, ride.rideDate, getWeather) : undefined;
  return analyseConditions({
    shapes: ride.shapes,
    legMinutes: ride.legs.map((l) => l.ridingMinutes),
    date: ride.rideDate,
    departure: ride.departure ?? "09:00",
    utcOffsetSeconds: utcOffsetSecondsOn(wind?.timezone ?? "Europe/Paris", ride.rideDate),
    wind: wind?.points,
  });
}

/** Surface line for the ride view, from the stored speed profile. */
export function formatSurface(ride: SavedRide): string | null {
  const surface = (
    ride.speedLimits as {
      surface?: {
        roughPavedKm: number;
        unpavedKm: number;
        stretches: Array<{ road: string; leg: number; surface: string; km: number }>;
      };
    } | null
  )?.surface;
  if (!surface) return null;
  if (!surface.roughPavedKm && !surface.unpavedKm) return "Surface: paved all the way";
  const worst = surface.stretches
    .slice(0, 3)
    .map((s) => `${s.road} (leg ${s.leg}, ${s.km} km ${s.surface})`)
    .join("; ");
  return `Surface: ${surface.roughPavedKm} km cobbles or setts, ${surface.unpavedKm} km unpaved: ${worst}`;
}
