/** Rider preferences applied to every routed trip. */
export interface RidePreferences {
  /** Never route over motorways (autoroutes). */
  avoidMotorways: boolean;
  /** Target ceiling for the share of the distance in zones limited to 30 km/h or less. */
  max30Pct: number;
  /** Target ceiling for the share of the distance in zones limited to 31-50 km/h. */
  max50Pct: number;
}

export const DEFAULT_PREFERENCES: RidePreferences = {
  avoidMotorways: true,
  max30Pct: 3,
  max50Pct: 20,
};
