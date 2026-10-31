import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { parseGpxTrack } from "./feedback.ts";
import type { Store } from "./store.ts";
import { haversineKm } from "./tools/geo.ts";

/** The most a recorded ride may weigh (the GPX, also once unzipped), and how many a library keeps (ADR 0054). */
export const MAX_RIDE_BYTES = 25 * 1024 * 1024;
export const MAX_RECORDED_RIDES = 200;
/** What the phone calls a ride: its start and the roadbook's name, e.g. `2026-10-31T09-00-00-pays-des-collines-loop`. */
export const RIDE_ID = /^[A-Za-z0-9._-]{1,120}$/;

export class RideRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RecordedRide {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  distanceKm: number;
  points: number;
  /** The roadbook of the library the ride followed, when its header says which and the library has it. */
  roadbook: { id: number; name: string } | null;
  uploadedAt: string;
}

/** The roadbook a ride's header names (`sourceRoadbook`, `sourceName`), when it is one of the rider's library; null otherwise. */
function roadbookOf(store: Store, header: string): { id: number; name: string } | null {
  const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(header)?.[1];
  const app = attr("source");
  const number = Number(attr("sourceRoadbook"));
  const named = unescapeXml(attr("sourceName") ?? "");
  if (!app || !Number.isInteger(number) || !named) return null;
  const rides = store.listRides();
  // A roadbook sent from the rider's other library is kept under the key of where it came from; one planned here under its own number.
  const sent = rides.find((r) => r.request === `roadbook file ${app}:${number}:${named}`);
  const own = rides.find((r) => r.id === number && r.name === named && !r.request.startsWith("roadbook file "));
  const found = sent ?? own;
  return found ? { id: found.id, name: found.name } : null;
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** What the server keeps of an uploaded GPX: its figures and the roadbook it followed. Throws RideRefused when it is not a ride. */
export function describeRide(store: Store, id: string, gpx: string): Omit<RecordedRide, "uploadedAt"> {
  if (!RIDE_ID.test(id))
    throw new RideRefused(400, "The ride id needs letters, digits, '.', '_' or '-' (at most 120).");
  let points;
  try {
    points = parseGpxTrack(gpx);
  } catch {
    throw new RideRefused(400, "Not a recorded ride: a GPX with at least two time-stamped track points is needed.");
  }
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1]!, points[i]!);
  const name = unescapeXml(/<metadata>[\s\S]*?<name>([^<]*)<\/name>/.exec(gpx)?.[1] ?? "").trim() || id;
  const header = /<motoride:ride\b([^>]*)\/?>/.exec(gpx)?.[1] ?? "";
  return {
    id,
    name: name.slice(0, 200),
    startedAt: new Date(points[0]!.time).toISOString(),
    endedAt: new Date(points.at(-1)!.time).toISOString(),
    distanceKm: Math.round(km * 10) / 10,
    points: points.length,
    roadbook: roadbookOf(store, header),
  };
}

/** Keeps a ride in the library: created, replaced by other content under the same id, or left as it was. */
export function keepRide(store: Store, id: string, gpx: string): { status: "created" | "replaced" | "unchanged" } {
  const ride = describeRide(store, id, gpx);
  const sha = createHash("sha256").update(gpx).digest("hex");
  const earlier = store.recordedRideHash(id);
  if (earlier === sha) return { status: "unchanged" };
  if (earlier === undefined && store.countRecordedRides() >= MAX_RECORDED_RIDES)
    throw new RideRefused(409, `This server keeps at most ${MAX_RECORDED_RIDES} rides; delete one first.`);
  store.putRecordedRide(ride, sha, gzipSync(Buffer.from(gpx, "utf8")));
  return { status: earlier === undefined ? "created" : "replaced" };
}

/** The GPX of a kept ride, or undefined. */
export function rideGpx(store: Store, id: string): string | undefined {
  const blob = store.recordedRideGpx(id);
  return blob ? gunzipSync(blob).toString("utf8") : undefined;
}

/** Unzips an upload sent with `Content-Encoding: gzip`, up to the size limit. Throws RideRefused(413 or 400). */
export function unzipUpload(body: Buffer, encoding: string | undefined): Buffer {
  if (!encoding || encoding === "identity") return body;
  if (encoding !== "gzip") throw new RideRefused(415, "Only gzip is accepted as Content-Encoding.");
  try {
    return gunzipSync(body, { maxOutputLength: MAX_RIDE_BYTES });
  } catch (e) {
    throw e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE"
      ? new RideRefused(413, "Too large.")
      : new RideRefused(400, "The gzip body cannot be read.");
  }
}
