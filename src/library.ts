import type { CurrentRide } from "./agent.ts";
import { centroid, decodePolyline } from "./geometry.ts";
import type { RideContext } from "./session.ts";
import type { NewRide, SavedRide } from "./store.ts";
import type { TripComputation } from "./tools/trip.ts";
import { formatUsage, type RunUsage } from "./usage.ts";

const fmtMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
const stars = (rating: number | null) => (rating === null ? "unrated" : `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`);

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

/** Store the current itinerary and its routed trip. Returns the new ride id. */
export function saveCurrentRide(
  context: RideContext,
  ride: CurrentRide,
  options: { name?: string; request: string; parentId: number | null; home: string; usage?: RunUsage },
): number {
  const { trip, cells } = ride.route;
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
    motorwayKm?: number;
  } | null;
  if (!s?.limit30OrLess || !s.limit31to50) return null;
  const open = s.openRoadPct ?? Number((100 - s.limit30OrLess.pct - s.limit31to50.pct).toFixed(1));
  const untagged = s.untaggedOpenRoad ? ` (${s.untaggedOpenRoad.pct}% with no tagged limit, legal default assumed)` : "";
  const motorway = ride.preferences.avoidMotorways ? "" : "  (motorways were allowed)";
  return `Road mix: ${open}% open road${untagged}${motorway}  |  ${s.limit31to50.pct}% in 31-50 zones  |  ${s.limit30OrLess.pct}% in zones of 30 or less  |  motorway ${s.motorwayKm ?? 0} km`;
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
    `Map: ${ride.mapsUrl}`,
    formatRoadMix(ride),
    ride.usage ? `Planned with: ${formatUsage(ride.usage)}` : null,
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
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error(`Rating must be a whole number from 1 to 5, got "${args[0] ?? ""}".`);
  }
  return { rating, notes: args.slice(1).join(" ").trim() || null };
}
