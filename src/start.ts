// Where a saved ride starts: from its first leg, so a loop started away from home
// is located and labelled where it starts, without changing what is stored.
import { townOf } from "./rideMap.ts";
import type { SavedRide } from "./store.ts";

/** Where a ride starts, as coordinates for lookups: its first leg's start, else the saved home. */
export function startPoint(ride: SavedRide): string {
  return ride.legs[0]?.fromCoords ?? ride.home;
}

/**
 * Where a ride starts, in words: the town of its first leg ("Thuin"), so a loop
 * started away from home is not labelled with the home; else the saved home.
 */
export function startLabel(ride: SavedRide): string {
  const from = ride.legs[0]?.from;
  if (!from) return ride.home;
  const parts = from.split(",").map((p) => p.trim());
  // "Thuin, Wallonia, Belgium": the place, not the region.
  if (!from.includes(" near ") && parts.length > 2) return parts[0]!;
  return townOf(from) ?? ride.home;
}
