import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type LimitProposal, proposalKm, proposeLowerLimits, ridePoints, USUAL_LIMITS } from "./limitProposals.ts";
import { rideGpx, roadbookOfGpx, type RecordedRide } from "./recordedRides.ts";
import { currentContext } from "./requestContext.ts";
import { traceRoadbookFile } from "./roadbookDownload.ts";
import type { Store } from "./store.ts";

export interface ProposalDecision {
  n: number;
  /** "confirm" keeps the proposed limit (or `kmh`), "reject" is not proposed again at that place */
  action: "confirm" | "reject";
  /** Another usual limit than the proposed one, lower than the guess */
  kmh?: number;
}

/** The ride to review: the one named (its id, or a part of it that only one ride has), else the latest. */
export function pickRecordedRide(store: Store, which?: string): RecordedRide {
  const rides = store.listRecordedRides();
  if (!rides.length)
    throw new Error(
      "No recorded ride in this library. Rides are uploaded from the MotoRide app (My rides, upload) to the rider's server: use the server's tools.",
    );
  if (!which?.trim()) return rides[0]!;
  const exact = rides.find((r) => r.id === which);
  if (exact) return exact;
  const part = rides.filter((r) => r.id.includes(which) || r.name.toLowerCase().includes(which.toLowerCase()));
  if (part.length === 1) return part[0]!;
  throw new Error(
    part.length
      ? `${part.length} recorded rides match "${which}": ${part.map((r) => r.id).join(", ")}.`
      : `No recorded ride matches "${which}". Call listRecordedRides.`,
  );
}

/** The roadbook file a ride is compared with: the one ready for the phone on a server, else traced now (a few minutes on a long one). */
async function roadbookFileOf(store: Store, id: number) {
  const root = currentContext().fileRoot;
  const ready = root ? join(root, "roadbooks-ready", `${id}.json`) : "";
  if (ready && existsSync(ready))
    return JSON.parse(readFileSync(ready, "utf8")) as Parameters<typeof proposeLowerLimits>[0];
  const ride = store.findRide(String(id))!;
  return JSON.parse(await traceRoadbookFile(store, ride)) as Parameters<typeof proposeLowerLimits>[0];
}

export interface RecordedReview {
  ride: RecordedRide;
  roadbook: { id: number; name: string } | null;
  proposals: LimitProposal[];
}

/** Compares a recorded ride with the roadbook it followed. No roadbook, no proposals. */
export async function reviewRecordedRide(store: Store, which?: string): Promise<RecordedReview> {
  const ride = pickRecordedRide(store, which);
  const gpx = rideGpx(store, ride.id)!;
  // A ride uploaded before its roadbook was in the library, or before the match was by name, is linked now.
  const roadbook = ride.roadbook ?? roadbookOfGpx(store, gpx);
  if (!roadbook) return { ride, roadbook: null, proposals: [] };
  const file = await roadbookFileOf(store, roadbook.id);
  return { ride, roadbook, proposals: proposeLowerLimits(file, ridePoints(gpx), store.listLimitCorrections()) };
}

/** What the rider reads. */
export function formatRecordedReview(review: RecordedReview): string {
  const { ride, roadbook, proposals } = review;
  const head = `Recorded ride ${ride.id}: "${ride.name}", ${ride.distanceKm} km, ${ride.startedAt.slice(0, 16).replace("T", " ")} UTC.`;
  if (!roadbook)
    return `${head}\nNo roadbook of this library matches it (it was ridden without one, or with another library's), so there is nothing to compare it with.`;
  if (!proposals.length)
    return `${head}\nCompared with roadbook #${roadbook.id} "${roadbook.name}": no limit to question. Only guessed limits are checked, and only where you held a steady speed well below the guess.`;
  const lines = proposals.map(
    (p) =>
      `${p.n}. ${p.road ?? "road"} near ${p.at.lat.toFixed(4)},${p.at.lon.toFixed(4)} (${proposalKm(p)} km): the roadbook guessed ${p.guess}; you held ${p.median} (85% of the time under ${p.p85}) for ${p.seconds} s. Proposed: ${p.proposed}.`,
  );
  return `${head}\nCompared with roadbook #${roadbook.id} "${roadbook.name}". ${proposals.length} guessed limit(s) look too high (one ride is weak evidence: you may have been cautious):\n${lines.join("\n")}\n\nFaster-than-planned stretches and limits from OpenStreetMap or signs are never listed: a speed does not raise a limit. Ask the rider which to confirm or reject (all their answers in one call: the numbers change after).`;
}

/** Keeps the rider's answers: a confirmed limit replaces the guess on that road in every roadbook; a rejected one is not proposed again. */
export function applyProposalDecisions(store: Store, review: RecordedReview, decisions: ProposalDecision[]): string[] {
  const out: string[] = [];
  for (const d of decisions) {
    const p = review.proposals.find((x) => x.n === d.n);
    if (!p) {
      out.push(`No proposal ${d.n}.`);
      continue;
    }
    if (d.action === "reject") {
      store.addLimitCorrection({ shape: p.shape, kmh: null, road: p.road, rideId: review.ride.id });
      out.push(`${d.n}. turned down: not proposed again there.`);
      continue;
    }
    const kmh = d.kmh ?? p.proposed;
    if (!USUAL_LIMITS.includes(kmh) || kmh >= p.guess) {
      out.push(`${d.n}. not kept: ${kmh} must be one of ${USUAL_LIMITS.filter((v) => v < p.guess).join(", ")}.`);
      continue;
    }
    store.addLimitCorrection({ shape: p.shape, kmh, road: p.road, rideId: review.ride.id });
    out.push(
      `${d.n}. ${p.road ?? "road"} near ${p.at.lat.toFixed(4)},${p.at.lon.toFixed(4)}: ${kmh} instead of ${p.guess}.`,
    );
  }
  if (out.some((l) => !/turned down|not kept|No proposal/.test(l)))
    out.push(
      "Kept. The roadbook file for the phone is made again by the phone's own refresh (open the roadbook in the app: 'under refresh', then the new file). refreshRide is not needed for this: it updates the saved ride's route, weather, cameras and stops, and does not renew the phone's file or its limits.",
    );
  return out;
}
