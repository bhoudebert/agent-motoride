import { decodePolyline, type LatLon } from "./geometry.ts";
import { bearingDeg, haversineKm } from "./tools/geo.ts";

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Smallest angle between two bearings, 0..180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Sun position for a place and an instant (NOAA approximation, about a degree).
 * Azimuth clockwise from north, elevation above the horizon, both in degrees.
 */
export function solarPosition(lat: number, lon: number, at: Date): { azimuthDeg: number; elevationDeg: number } {
  const start = Date.UTC(at.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((at.getTime() - start) / 86_400_000) + 1;
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = hour * 60 + eqTime + 4 * lon;
  const hourAngle = rad(trueSolarMinutes / 4 - 180);
  const phi = rad(lat);
  const cosZenith = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const azimuth =
    (deg(Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi))) + 180) %
    360;
  return { azimuthDeg: azimuth, elevationDeg: 90 - deg(zenith) };
}

/** Wind component across the direction of travel, km/h. `windFromDeg` is where the wind blows from. */
export function crosswindKmh(windKmh: number, windFromDeg: number, headingDeg: number): number {
  return Math.abs(windKmh * Math.sin(rad(windFromDeg - headingDeg)));
}

/** Low sun ahead: up to 15 degrees above the horizon and within 30 degrees of the heading. */
export function isGlare(sun: { azimuthDeg: number; elevationDeg: number }, headingDeg: number): boolean {
  return sun.elevationDeg > 0 && sun.elevationDeg <= 15 && angleBetween(sun.azimuthDeg, headingDeg) <= 30;
}

export interface RouteSample extends LatLon {
  km: number;
  leg: number;
  headingDeg: number;
  /** Minutes after departure, riding time only. */
  minutes: number;
}

/**
 * Points every `stepKm` along the route, with heading over the next kilometre
 * and time of passage interpolated from each leg's riding minutes.
 */
export function sampleRoute(shapes: string[], legMinutes: number[], stepKm = 2): RouteSample[] {
  const samples: RouteSample[] = [];
  let kmBefore = 0;
  let minutesBefore = 0;
  shapes.forEach((shape, legIdx) => {
    const pts = decodePolyline(shape);
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + haversineKm(pts[i - 1]!, pts[i]!));
    const legKm = cum.at(-1) ?? 0;
    const legMin = legMinutes[legIdx] ?? 0;
    let next = legIdx === 0 ? 0 : stepKm - (kmBefore % stepKm);
    for (let i = 0; i < pts.length - 1; i++) {
      while (cum[i + 1]! >= next && next <= legKm) {
        // Heading over roughly the next kilometre smooths out hairpins.
        let j = i + 1;
        while (j < pts.length - 1 && cum[j]! - cum[i]! < 1) j++;
        samples.push({
          ...pts[i]!,
          km: kmBefore + next,
          leg: legIdx + 1,
          headingDeg: bearingDeg(pts[i]!, pts[j]!),
          minutes: minutesBefore + (legKm > 0 ? (next / legKm) * legMin : 0),
        });
        next += stepKm;
      }
    }
    kmBefore += legKm;
    minutesBefore += legMin;
  });
  return samples;
}

export interface WindPoint extends LatLon {
  /** Hourly values for the ride date, local hours. */
  hours: Array<{ hour: number; windKmh: number; gustKmh: number; windFromDeg: number | null }>;
}

export interface Stretch {
  leg: number;
  fromKm: number;
  toKm: number;
  /** Local clock time when the stretch starts. */
  at: string;
  detail: string;
  /** Worst value in the stretch: crosswind gust km/h, or sun elevation degrees. */
  value: number;
}

export interface RideConditions {
  crosswind: Stretch[];
  glare: Stretch[];
  windChecked: boolean;
  summary: string[];
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (d: number) => COMPASS[Math.round((((d % 360) + 360) % 360) / 45) % 8]!;
const clock = (minutes: number) =>
  `${String(Math.floor((((minutes % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(Math.round(minutes % 60) % 60).padStart(2, "0")}`;

/** Merge flagged samples less than 6 km apart into stretches; the first sample's leg and time label it. */
function stretches(
  samples: Array<RouteSample & { flagged: boolean; value: number; detail: string }>,
  departMinutes: number,
  worst: "max" | "min",
): Stretch[] {
  const out: Stretch[] = [];
  let current: Stretch | undefined;
  for (const s of samples) {
    // An unflagged sample does not end the stretch; a gap of more than 6 km does.
    if (!s.flagged) continue;
    if (current && s.km - current.toKm <= 6) {
      current.toKm = s.km;
      if (worst === "max" ? s.value > current.value : s.value < current.value) {
        current.value = s.value;
        current.detail = s.detail;
      }
      continue;
    }
    current = {
      leg: s.leg,
      fromKm: Number(s.km.toFixed(1)),
      toKm: s.km,
      at: clock(departMinutes + s.minutes),
      detail: s.detail,
      value: s.value,
    };
    out.push(current);
  }
  for (const s of out) s.toKm = Number(s.toKm.toFixed(1));
  return out;
}

/**
 * Crosswind and low-sun stretches along a route for a date and departure.
 * `utcOffsetSeconds` localises the departure; wind comes from the nearest of
 * the given forecast points for the hour of passage (omit for glare only).
 */
export function analyseConditions(input: {
  shapes: string[];
  legMinutes: number[];
  date: string;
  departure: string;
  utcOffsetSeconds: number;
  wind?: WindPoint[];
}): RideConditions {
  const [dh = 9, dm = 0] = input.departure.split(":").map(Number);
  const departMinutes = dh * 60 + dm;
  const samples = sampleRoute(input.shapes, input.legMinutes);
  const midnightUtc = Date.parse(`${input.date}T00:00:00Z`) - input.utcOffsetSeconds * 1000;

  const glare = samples.map((s) => {
    const sun = solarPosition(s.lat, s.lon, new Date(midnightUtc + (departMinutes + s.minutes) * 60_000));
    return {
      ...s,
      flagged: isGlare(sun, s.headingDeg),
      value: Number(sun.elevationDeg.toFixed(0)),
      detail: `sun ${sun.elevationDeg.toFixed(0)}° above the horizon, ahead (${compass(sun.azimuthDeg)})`,
    };
  });

  const wind = input.wind?.length
    ? samples.map((s) => {
        const point = input.wind!.reduce((best, p) => (haversineKm(p, s) < haversineKm(best, s) ? p : best));
        const hour = Math.floor((departMinutes + s.minutes) / 60) % 24;
        const h = point.hours.find((x) => x.hour === hour) ?? point.hours.at(-1);
        if (!h || h.windFromDeg === null) return { ...s, flagged: false, value: 0, detail: "" };
        const cross = crosswindKmh(h.gustKmh, h.windFromDeg, s.headingDeg);
        return {
          ...s,
          flagged: cross >= 35,
          value: Math.round(cross),
          detail: `gusts ${Math.round(h.gustKmh)} km/h from ${compass(h.windFromDeg)}, ${Math.round(cross)} km/h across`,
        };
      })
    : [];

  const crosswind = stretches(wind, departMinutes, "max");
  const glareStretches = stretches(glare, departMinutes, "min");
  const summary: string[] = [];
  for (const c of crosswind)
    summary.push(
      `${c.value >= 50 ? "Strong crosswind" : "Crosswind"} km ${c.fromKm}-${c.toKm} (leg ${c.leg}, ~${c.at}): ${c.detail}`,
    );
  for (const g of glareStretches)
    summary.push(`Low sun ahead km ${g.fromKm}-${g.toKm} (leg ${g.leg}, ~${g.at}): ${g.detail}`);
  if (!summary.length)
    summary.push(
      input.wind?.length ? "No strong crosswind, no low sun ahead." : "No low sun ahead (wind not checked).",
    );
  return { crosswind, glare: glareStretches, windChecked: Boolean(input.wind?.length), summary };
}

/**
 * Wind forecast at the start, the thirds and the finish of a route for a date,
 * through the given weather fetcher. Returns the points and the timezone.
 */
export async function windAlong(
  shapes: string[],
  date: string,
  fetchWeather: (input: { location: string; date: string; fromHour: number; toHour: number }) => Promise<{
    timezone: string;
    hours: Array<{ hour: number; windKmh: number; gustKmh: number; windFromDeg: number | null }>;
  }>,
): Promise<{ points: WindPoint[]; timezone: string }> {
  const line = shapes.flatMap((sh) => decodePolyline(sh));
  const picks = [0, 1 / 3, 2 / 3, 1].map((f) => line[Math.min(line.length - 1, Math.round(f * (line.length - 1)))]!);
  const points: WindPoint[] = [];
  let timezone = "UTC";
  for (const p of picks) {
    const w = await fetchWeather({ location: `${p.lat},${p.lon}`, date, fromHour: 0, toHour: 23 });
    timezone = w.timezone;
    points.push({
      lat: p.lat,
      lon: p.lon,
      hours: w.hours.map((h) => ({ hour: h.hour, windKmh: h.windKmh, gustKmh: h.gustKmh, windFromDeg: h.windFromDeg })),
    });
  }
  return { points, timezone };
}
