import { decodePolyline, encodePolyline, type LatLon } from "./geometry.ts";
import { axisAngle, metresToSegment } from "./signs.ts";
import { bearingDeg, haversineKm } from "./tools/geo.ts";

/**
 * Limits learned from a recorded ride (ADR 0055): where the plan only guessed a limit and the rider held a steady, much lower
 * speed, the real limit is probably lower. A speed never raises a limit, and a proposal changes nothing until the rider confirms it.
 */

/** The usual limits a proposal may take. */
export const USUAL_LIMITS = [30, 50, 60, 70, 80, 90];
/** A moving point is above this speed, km/h. */
const MOVING_KMH = 5;
/** A stretch needs this many seconds of moving points, a spread (85th percentile over the median) no wider than this, and a speed this far under the guess. */
export const MIN_SECONDS = 15;
export const MAX_SPREAD_KMH = 8;
export const MIN_GAP_KMH = 20;
/** Room for a rider a little under or over the limit: the proposal is the usual limit not below the 85th percentile minus this. */
export const MARGIN_KMH = 3;
/** A ride point belongs to the line when it is this close, m. */
const NEAR_LINE_M = 40;
/** A correction applies to a road within this distance of where it was made, m, and along it. */
const CORRECTION_REACH_M = 15;
const AXIS_TOLERANCE_DEG = 35;

export interface RidePoint {
  lat: number;
  lon: number;
  /** ms since epoch */
  time: number;
  /** km/h */
  kmh: number;
}

/** The points of a recorded GPX with their speed: the app's own (`motoride:speed`, m/s) or, lacking it, from the distance covered. */
export function ridePoints(gpx: string): RidePoint[] {
  const raw: Array<{ lat: number; lon: number; time: number; speed: number | null }> = [];
  for (const match of gpx.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const lat = Number(/\blat="([^"]+)"/.exec(attrs)?.[1]);
    const lon = Number(/\blon="([^"]+)"/.exec(attrs)?.[1]);
    const time = Date.parse(/<time>([^<]+)<\/time>/.exec(body)?.[1] ?? "");
    const speed = /<motoride:speed>([^<]+)<\/motoride:speed>/.exec(body)?.[1];
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(time))
      raw.push({ lat, lon, time, speed: speed !== undefined && Number.isFinite(Number(speed)) ? Number(speed) : null });
  }
  raw.sort((a, b) => a.time - b.time);
  return raw.map((p, i) => {
    let kmh: number;
    if (p.speed !== null) kmh = p.speed * 3.6;
    else if (i === 0) kmh = 0;
    else {
      const dt = (p.time - raw[i - 1]!.time) / 1000;
      kmh = dt > 0 ? (haversineKm(raw[i - 1]!, p) / dt) * 3600 : 0;
    }
    return { lat: p.lat, lon: p.lon, time: p.time, kmh };
  });
}

/**
 * The index of the line each ride point is on (null when it is off the line), going forward along it: a loop passes the same
 * place twice, so a point is looked for ahead of the last one placed. The first point is the nearest of the whole line; a
 * ride lost for a while (a detour) finds the line again ahead.
 */
export function placeOnLine(line: LatLon[], ride: RidePoint[]): Array<number | null> {
  const placed: Array<number | null> = [];
  let last = -1;
  let lost = 0;
  const nearest = (p: LatLon, lo: number, hi: number): { index: number; m: number } => {
    let index = -1;
    let m = Infinity;
    for (let i = lo; i <= hi; i++) {
      const d = haversineKm(p, line[i]!) * 1000;
      if (d < m) {
        m = d;
        index = i;
      }
    }
    return { index, m };
  };
  for (const p of ride) {
    const lo = last < 0 ? 0 : Math.max(0, last - 30);
    const hi = last < 0 ? line.length - 1 : Math.min(line.length - 1, last + (lost > 20 ? 3000 : 600));
    const { index, m } = nearest(p, lo, hi);
    if (index >= 0 && m <= NEAR_LINE_M) {
      placed.push(index);
      last = index;
      lost = 0;
    } else {
      placed.push(null);
      lost++;
    }
  }
  return placed;
}

export interface LimitProposal {
  /** 1, 2, 3 in riding order: how a rider refers to it */
  n: number;
  from: number;
  to: number;
  at: LatLon;
  road?: string;
  guess: number;
  /** the median and the 85th percentile of the speed held, km/h */
  median: number;
  p85: number;
  seconds: number;
  proposed: number;
  /** the stretch of road, encoded, to keep when the rider confirms */
  shape: string;
}

/** A correction the rider made: the road it holds on (encoded) and the limit; kmh null means the rider turned the proposal down. */
export interface LimitCorrection {
  shape: string;
  kmh: number | null;
}

const bearingOf = (points: LatLon[], from: number, to: number): number => bearingDeg(points[from]!, points[to]!);

/** The corrections whose road the stretch of `points` (indexes from to to) lies on: near its middle and along it. */
function onCorrection(
  corrections: Array<{ points: LatLon[]; kmh: number | null }>,
  points: LatLon[],
  from: number,
  to: number,
) {
  const mid = points[Math.round((from + to) / 2)]!;
  const way = bearingOf(points, from, to);
  return corrections.filter((c) => {
    for (let i = 0; i + 1 < c.points.length; i++) {
      if (metresToSegment(mid, c.points[i]!, c.points[i + 1]!) > CORRECTION_REACH_M) continue;
      if (axisAngle(way, bearingDeg(c.points[i]!, c.points[i + 1]!)) <= AXIS_TOLERANCE_DEG) return true;
    }
    return false;
  });
}

const decoded = (corrections: LimitCorrection[]) =>
  corrections.map((c) => ({ points: decodePolyline(c.shape), kmh: c.kmh }));

/** The limit the rider confirmed for a stretch of a line (point indexes from to to), or null: for the roadbook builder (ADR 0055). */
export type CorrectedLimit = (points: LatLon[], from: number, to: number) => number | null;

export function correctedLimits(corrections: LimitCorrection[]): CorrectedLimit | undefined {
  const confirmed = decoded(corrections.filter((c) => c.kmh !== null));
  if (!confirmed.length) return undefined;
  return (points, from, to) => {
    const kmh = onCorrection(confirmed, points, from, to)[0]?.kmh;
    return kmh ?? null;
  };
}

const quantile = (sorted: number[], q: number): number => sorted[Math.floor(q * (sorted.length - 1))]!;

/**
 * The lower limits a ride suggests for a roadbook file: only stretches whose limit is not posted (a guess or inferred), only
 * where the rider held a steady speed (see the constants) well below it, and never a place the rider turned down or already
 * corrected. `file.line` is the encoded line; `file.limits` index into it.
 */
export function proposeLowerLimits(
  file: {
    line: string;
    limits: Array<{ from: number; to: number; kmh: number; posted: boolean; road?: string; source?: string }>;
  },
  ride: RidePoint[],
  corrections: LimitCorrection[] = [],
): LimitProposal[] {
  const line = decodePolyline(file.line);
  const placed = placeOnLine(line, ride);
  const known = decoded(corrections);
  const out: LimitProposal[] = [];
  for (const stretch of file.limits) {
    if (stretch.posted || stretch.source === "sign" || stretch.source === "ride") continue;
    const inside: RidePoint[] = [];
    let seconds = 0;
    let before: { time: number } | null = null;
    for (const [i, p] of ride.entries()) {
      const at = placed[i];
      if (at === null || at === undefined || at < stretch.from || at >= stretch.to) {
        before = null;
        continue;
      }
      if (p.kmh > MOVING_KMH) {
        inside.push(p);
        if (before && p.time - before.time <= 5000) seconds += (p.time - before.time) / 1000;
      }
      before = p;
    }
    if (seconds < MIN_SECONDS) continue;
    const speeds = inside.map((p) => p.kmh).sort((a, b) => a - b);
    const median = quantile(speeds, 0.5);
    const p85 = quantile(speeds, 0.85);
    if (p85 - median > MAX_SPREAD_KMH || stretch.kmh - p85 < MIN_GAP_KMH) continue;
    const proposed = USUAL_LIMITS.find((v) => v >= p85 - MARGIN_KMH);
    if (proposed === undefined || proposed >= stretch.kmh) continue;
    if (onCorrection(known, line, stretch.from, stretch.to).length) continue;
    const mid = line[Math.round((stretch.from + stretch.to) / 2)]!;
    out.push({
      n: 0,
      from: stretch.from,
      to: stretch.to,
      at: mid,
      ...(stretch.road ? { road: stretch.road } : {}),
      guess: stretch.kmh,
      median: Math.round(median),
      p85: Math.round(p85),
      seconds: Math.round(seconds),
      proposed,
      shape: encodePolyline(line.slice(stretch.from, stretch.to + 1)),
    });
  }
  return out.sort((a, b) => a.from - b.from).map((p, i) => ({ ...p, n: i + 1 }));
}

/** Kilometres of a proposal's stretch, for telling it. */
export const proposalKm = (p: LimitProposal): number => {
  const points = decodePolyline(p.shape);
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1]!, points[i]!);
  return Math.round(km * 10) / 10;
};
