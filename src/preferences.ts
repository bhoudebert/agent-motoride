/** Rider preferences applied to every routed trip. */
export interface RidePreferences {
  /** Never route over motorways (autoroutes). */
  avoidMotorways: boolean;
  /** Target ceiling for the share of the distance in zones limited to 30 km/h or less. */
  max30Pct: number;
  /** Target ceiling for the share of the distance in zones limited to 31-50 km/h. */
  max50Pct: number;
  /**
   * Ceiling for the share of a leisure ride on fast expressways (not motorways,
   * limited to 100 km/h or more), checked while motorways are forbidden; 100 turns
   * the check off. Absent on roadbooks saved before it existed: the default applies.
   */
  maxFastPct?: number;
}

/** The fast-expressway ceiling when none is set. */
export const DEFAULT_MAX_FAST_PCT = 25;

export const DEFAULT_PREFERENCES: RidePreferences = {
  avoidMotorways: true,
  max30Pct: 3,
  max50Pct: 20,
  maxFastPct: DEFAULT_MAX_FAST_PCT,
};

/** Preferences from the environment (RIDE_ALLOW_MOTORWAYS, RIDE_MAX_30_PCT, RIDE_MAX_50_PCT, RIDE_MAX_FAST_PCT), defaults otherwise. */
export function preferencesFromEnv(env: NodeJS.ProcessEnv = process.env): RidePreferences {
  const pct = (raw: string | undefined, fallback: number) => {
    const value = Number(raw);
    return raw && Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
  };
  return {
    avoidMotorways: !["1", "true"].includes(env.RIDE_ALLOW_MOTORWAYS ?? ""),
    max30Pct: pct(env.RIDE_MAX_30_PCT, DEFAULT_PREFERENCES.max30Pct),
    max50Pct: pct(env.RIDE_MAX_50_PCT, DEFAULT_PREFERENCES.max50Pct),
    maxFastPct: pct(env.RIDE_MAX_FAST_PCT, DEFAULT_MAX_FAST_PCT),
  };
}
