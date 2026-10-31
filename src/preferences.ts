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
  /**
   * Target ceiling for the share of the distance on long straights (2 km or more
   * on one straight line, ADR 0025). Weighs more than the 31-50 zones. Absent on
   * roadbooks saved before it existed: the default applies.
   */
  maxStraightPct?: number;
}

/** The fast-expressway ceiling when none is set. */
export const DEFAULT_MAX_FAST_PCT = 25;

/** The long-straight target when none is set. */
export const DEFAULT_MAX_STRAIGHT_PCT = 15;

export const DEFAULT_PREFERENCES: RidePreferences = {
  avoidMotorways: true,
  max30Pct: 3,
  max50Pct: 20,
  maxFastPct: DEFAULT_MAX_FAST_PCT,
  maxStraightPct: DEFAULT_MAX_STRAIGHT_PCT,
};

/** Preferences from the environment (RIDE_ALLOW_MOTORWAYS, RIDE_MAX_30_PCT, RIDE_MAX_50_PCT, RIDE_MAX_FAST_PCT, RIDE_MAX_STRAIGHT_PCT), defaults otherwise. */
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
    maxStraightPct: pct(env.RIDE_MAX_STRAIGHT_PCT, DEFAULT_MAX_STRAIGHT_PCT),
  };
}

/** What a rider has set and the library keeps: home and the road preferences. Absent means the host's default applies. */
export interface RiderSettings extends Partial<RidePreferences> {
  /** The start and end point, as the rider gave it (a town, an address or "lat,lon"). */
  home?: string;
}

/** The keys a library may keep, with what each accepts. */
export const SETTING_KEYS = ["home", "avoidMotorways", "max30Pct", "max50Pct", "maxFastPct", "maxStraightPct"] as const;

/**
 * The preferences a session starts with: the rider's saved ones over the host's environment over the defaults. The
 * environment is where a host (or a person using the terminal) sets what a rider has not chosen; what a rider saved wins.
 */
export function effectivePreferences(saved: RiderSettings, env: NodeJS.ProcessEnv = process.env): RidePreferences {
  const base = preferencesFromEnv(env);
  const out = { ...base };
  for (const key of SETTING_KEYS) {
    if (key === "home") continue;
    const value = saved[key];
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
