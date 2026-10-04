/** The bike and the rider's rhythm, used to place fuel and pause stops. */
export interface BikeProfile {
  /** Realistic range on a full tank, km. */
  tankRangeKm: number;
  /** Fuel before the range runs out, km. */
  reserveKm: number;
  /** Pause after this much riding, minutes. */
  pauseEveryMin: number;
  /** Longest stretch without any stop before a warning, minutes. */
  maxStintMin: number;
  /** Plan a lunch stop when the ride spans the lunch hours. */
  lunch: boolean;
}

export const DEFAULT_PROFILE: BikeProfile = {
  tankRangeKm: 250,
  reserveKm: 40,
  pauseEveryMin: 75,
  maxStintMin: 90,
  lunch: true,
};

export function describeProfile(p: BikeProfile): string {
  return `tank range ${p.tankRangeKm} km, fuel by ${p.tankRangeKm - p.reserveKm} km (${p.reserveKm} km reserve), pause every ${p.pauseEveryMin} min, max stint ${p.maxStintMin} min, lunch ${p.lunch ? "when the ride spans midday" : "no"}`;
}

/** Parse "key=value" or "--key value" style settings into a partial profile. */
export function parseProfileArgs(args: string[]): Partial<BikeProfile> {
  const out: Partial<BikeProfile> = {};
  const map: Record<string, keyof BikeProfile> = {
    range: "tankRangeKm",
    reserve: "reserveKm",
    pause: "pauseEveryMin",
    stint: "maxStintMin",
    lunch: "lunch",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    let key: string;
    let value: string | undefined;
    if (arg.includes("=")) [key, value] = arg.split("=", 2) as [string, string];
    else if (arg.startsWith("--")) {
      key = arg.slice(2);
      value = args[++i];
    } else throw new Error(`Unknown setting "${arg}". Use range=250 reserve=40 pause=75 stint=90 lunch=yes`);
    const field = map[key.replace(/^--/, "").toLowerCase()];
    if (!field) throw new Error(`Unknown setting "${key}". Known: range, reserve, pause, stint, lunch`);
    if (field === "lunch") out.lunch = ["yes", "true", "1", "on"].includes((value ?? "").toLowerCase());
    else {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} needs a positive number, got "${value ?? ""}"`);
      out[field] = n;
    }
  }
  return out;
}
