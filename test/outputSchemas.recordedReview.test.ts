// The structured form of a recorded-ride review, built from real proposals (the fake router of the MCP
// tests traces roads without a guessed limit, so no proposal comes out of the tool itself there).
import assert from "node:assert/strict";
import { test } from "node:test";
import { proposeLowerLimits, type RidePoint } from "../src/limitProposals.ts";
import { type RecordedReview, recordedReviewFacts } from "../src/recordedReview.ts";
import { buildRoadbookFile } from "../src/roadbookFile.ts";
import { RIDE_OUTPUT_SCHEMAS } from "../src/rideOutputSchemas.ts";
import { haversineKm } from "../src/tools/geo.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const line = bentLine({ lat: 50.4, lon: 3.0 }, { lat: 50.42, lon: 3.0 }, 61);
const legs = [{ from: "Home", to: "Mont", fromCoords: "50.4,3", toCoords: "50.42,3" }];
const FR = [{ country_code: "FR", state_code: "HDF" }];
const edge = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
  length: 20,
  road_class: "secondary",
  density: 2,
  names: ["D 955"],
  begin_shape_index: from,
  end_shape_index: to,
  end_node: { admin_index: 0 },
  ...extra,
});

/** A ride along the line holding 50 km/h on the first half and 80 on the second. */
function ride(): RidePoint[] {
  let time = Date.UTC(2026, 9, 30, 13, 0, 0);
  return line.map((point, i) => {
    const kmh = i < 30 ? 50 : 80;
    if (i > 0) time += (haversineKm(line[i - 1]!, point) / kmh) * 3_600_000;
    return { ...point, time, kmh };
  });
}

test("a review with real proposals matches the tool's output schema, as a review and as decisions applied", async () => {
  const { file } = await buildRoadbookFile(
    { name: "Device loop", description: "", legs, shapes: [encodePolyline(line)] },
    async (shape: string) => ({
      shape,
      admins: FR,
      edges: [edge(0, 30), edge(30, 60, { speed_limit: 80 })] as any[],
    }),
  );
  const proposals = proposeLowerLimits(file, ride());
  assert.equal(proposals.length, 1);
  const review = {
    ride: { id: "2026-10-30T13-00-00-device-loop", name: "Device loop", distanceKm: 2.2 },
    roadbook: { id: 1, name: "Device loop" },
    proposals,
  } as RecordedReview;

  const facts = recordedReviewFacts("review", review, []);
  const parsed = RIDE_OUTPUT_SCHEMAS.reviewRecordedRide.parse(facts);
  assert.deepEqual(parsed, facts, "the schema leaves out no field of the result");
  assert.deepEqual([facts.proposals[0]!.n, facts.proposals[0]!.guess, facts.proposals[0]!.proposed], [1, 80, 50]);
  assert.equal(facts.proposals[0]!.road, "D 955");
  assert.ok(!("shape" in facts.proposals[0]!), "the geometry kept for confirming is not sent");

  const applied = recordedReviewFacts("applied", review, ["1. D 955 near 50.4000,3.0000: 50 instead of 80."]);
  assert.deepEqual(RIDE_OUTPUT_SCHEMAS.reviewRecordedRide.parse(applied), applied);
});
