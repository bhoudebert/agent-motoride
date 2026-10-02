import type { CurrentRide } from "./agent.ts";
import { centroid, decodePolyline } from "./geometry.ts";
import type { RideContext } from "./session.ts";
import type { SavedRide } from "./store.ts";

const fmtMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
const stars = (rating: number | null) => (rating === null ? "unrated" : `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`);

/** Store the current itinerary and its routed trip. Returns the new ride id. */
export function saveCurrentRide(
  context: RideContext,
  ride: CurrentRide,
  options: { name?: string; request: string; parentId: number | null; home: string },
): number {
  const { trip, cells } = ride.route;
  const centre = centroid(trip.shapes.flatMap((shape) => decodePolyline(shape)));
  const id = context.store.saveRide({
    name: options.name?.trim() || ride.title,
    parentId: options.parentId,
    home: options.home,
    rideDate: ride.rideDate,
    departure: ride.departure,
    distanceKm: trip.result.totalDistanceKm,
    ridingMinutes: trip.result.totalRidingMinutes,
    waypoints: trip.waypoints,
    roundTrip: trip.roundTrip,
    speedLimits: trip.result.speedLimits,
    preferences: context.preferences,
    request: options.request,
    itinerary: ride.itinerary,
    mapsUrl: trip.result.mapsUrl,
    cells,
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
  });
  // Later versions in this session should not be rejected for resembling this one.
  context.lineage.add(id);
  return id;
}

export function formatRideLine(ride: SavedRide): string {
  const parent = ride.parentId ? ` (from #${ride.parentId})` : "";
  return `#${ride.id}  ${ride.name}${parent}  |  ${ride.distanceKm} km, ${fmtMinutes(ride.ridingMinutes)}  |  ${ride.rideDate ?? "no date"}  |  from ${ride.home}  |  ${stars(ride.rating)}`;
}

export function formatRideList(rides: SavedRide[]): string {
  return rides.length === 0 ? "No saved rides yet." : rides.map(formatRideLine).join("\n");
}

export function formatRideDetail(ride: SavedRide): string {
  const legs = ride.legs.map((leg) => {
    const rating = leg.rating === null ? "" : `  ${stars(leg.rating)}`;
    const notes = leg.notes ? `\n      note: ${leg.notes}` : "";
    return `  ${leg.seq}. ${leg.from} -> ${leg.to}  ${leg.distanceKm} km, ${fmtMinutes(leg.ridingMinutes)}${rating}\n      ${leg.mainRoads.join(", ") || "roads not recorded"}${notes}`;
  });
  return [
    formatRideLine(ride),
    `Saved ${ride.createdAt.slice(0, 10)}, departure ${ride.departure ?? "not set"}`,
    ride.notes ? `Note: ${ride.notes}` : null,
    `Request: ${ride.request}`,
    `Map: ${ride.mapsUrl}`,
    "Legs:",
    ...legs,
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
