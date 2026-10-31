import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodePolyline } from "../src/geometry.ts";
import { correctedLimits, placeOnLine, proposeLowerLimits, ridePoints, type RidePoint } from "../src/limitProposals.ts";
import { keepRide } from "../src/recordedRides.ts";
import { applyProposalDecisions, formatRecordedReview, reviewRecordedRide } from "../src/recordedReview.ts";
import { runInContext } from "../src/requestContext.ts";
import { rideStamp } from "../src/roadbookDownload.ts";
import { buildRoadbookFile } from "../src/roadbookFile.ts";
import { Store } from "../src/store.ts";
import { haversineKm } from "../src/tools/geo.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const line = bentLine({ lat: 50.4, lon: 3.0 }, { lat: 50.42, lon: 3.0 }, 61);
const shapes = [encodePolyline(line)];
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
const tracing = (edges: unknown[]) => async (shape: string) => ({ shape, admins: FR, edges: edges as any[] });
const input = { name: "Device loop", description: "", legs, shapes };

/** A ride along the line: `kmh(i)` is the speed at point i, 1 point per line point, the time follows from the distance. */
function ride(kmh: (i: number) => number, from = 0, to = line.length - 1): RidePoint[] {
  const out: RidePoint[] = [];
  let time = Date.UTC(2026, 9, 30, 13, 0, 0);
  for (let i = from; i <= to; i++) {
    if (i > from) time += (haversineKm(line[i - 1]!, line[i]!) / kmh(i)) * 3_600_000;
    out.push({ ...line[i]!, time, kmh: kmh(i) });
  }
  return out;
}

/** Two stretches: 0-30 unposted (a guessed 80), 30-60 posted by OpenStreetMap at 80. */
async function roadbookFile() {
  const { file } = await buildRoadbookFile(input, tracing([edge(0, 30), edge(30, 60, { speed_limit: 80 })]));
  return file;
}

test("a steady lower speed on a guessed limit is proposed, rounded to a usual limit", async () => {
  const file = await roadbookFile();
  assert.deepEqual(
    file.limits.map((l) => [l.from, l.to, l.kmh, l.posted]),
    [
      [0, 30, 80, false],
      [30, 60, 80, true],
    ],
  );
  // 49 to 51 km/h for about 80 s.
  const proposals = proposeLowerLimits(
    file,
    ride((i) => (i < 30 ? 49 + (i % 3) : 80)),
  );
  assert.equal(proposals.length, 1);
  const p = proposals[0]!;
  assert.deepEqual([p.n, p.from, p.to, p.guess, p.proposed, p.median, p.p85], [1, 0, 30, 80, 50, 50, 51]);
  assert.ok(p.seconds >= 60);
  assert.ok(decodePolyline(p.shape).length >= 30);
});

test("no proposal: a posted limit, a speed above the plan, a bend, a short stretch, or no plateau", async () => {
  const file = await roadbookFile();
  // Slow on the posted 80 (30-60): OpenStreetMap is right, the rider was cautious.
  assert.deepEqual(
    proposeLowerLimits(
      file,
      ride((i) => (i < 30 ? 80 : 45)),
    ),
    [],
  );
  // Fast on an inferred 50 (a speed never raises a limit).
  const { file: town } = await buildRoadbookFile(
    input,
    tracing([edge(0, 30, { road_class: "residential" }), edge(30, 60, { speed_limit: 80 })]),
  );
  assert.deepEqual(
    proposeLowerLimits(
      { ...town, limits: town.limits.map((l) => ({ ...l, kmh: 50, source: "inferred" })) },
      ride((i) => (i < 30 ? 67 : 80)),
    ),
    [],
  );
  // A plateau close to the guess: 70 under a guessed 80 is not 20 below.
  assert.deepEqual(
    proposeLowerLimits(
      file,
      ride((i) => (i < 30 ? 70 : 80)),
    ),
    [],
  );
  // Not a plateau: alternating 20 and 60.
  assert.deepEqual(
    proposeLowerLimits(
      file,
      ride((i) => (i < 30 ? (i % 2 ? 20 : 60) : 80)),
    ),
    [],
  );
  // Too short: 8 points at 50 km/h is about 20 s but only 5 are on the stretch.
  assert.deepEqual(
    proposeLowerLimits(
      file,
      ride(() => 50, 25, 32),
    ),
    [],
  );
  // Stopped (under 5 km/h) is not riding.
  assert.deepEqual(
    proposeLowerLimits(
      file,
      ride((i) => (i < 30 ? 3 : 80)),
    ),
    [],
  );
});

test("a rider a little over or under the limit still gets the limit they were near: 63 to 66 is a 70, not 60", async () => {
  const file = await roadbookFile();
  const [p] = proposeLowerLimits(
    { ...file, limits: [{ ...file.limits[0]!, kmh: 90 }, file.limits[1]!] },
    ride((i) => (i < 30 ? 63 + (i % 4) : 80)),
  );
  assert.equal(p!.proposed, 70);
});

test("the ride is placed along the line, ahead of the last point, so a loop passing twice is not confused", () => {
  const out = line.slice(0, 31);
  const back = [...out, ...out.slice(0, -1).reverse(), ...out.slice(1)];
  const rideBack = back.map((p, i) => ({ ...p, time: i * 1000, kmh: 40 }));
  const placed = placeOnLine(back, rideBack);
  assert.equal(placed.filter((x) => x === null).length, 0);
  assert.ok(placed[placed.length - 1]! > placed[0]!, "it goes forward");
  // A point far from the line is off it.
  assert.deepEqual(placeOnLine(line, [{ lat: 51, lon: 4, time: 0, kmh: 30 }]), [null]);
});

test("the ride's speeds come from the app's extension, else from the distance covered", () => {
  const pt = (lat: number, s: number, speed?: number) =>
    `<trkpt lat="${lat}" lon="3"><time>${new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()}</time>${speed === undefined ? "" : `<extensions><motoride:speed>${speed}</motoride:speed></extensions>`}</trkpt>`;
  const withSpeed = ridePoints(`<gpx>${pt(50, 0, 10)}${pt(50.0001, 1, 12.5)}</gpx>`);
  assert.deepEqual(
    withSpeed.map((p) => Math.round(p.kmh)),
    [36, 45],
  );
  const derived = ridePoints(`<gpx>${pt(50, 0)}${pt(50.0001, 1)}</gpx>`);
  assert.equal(derived[0]!.kmh, 0);
  assert.ok(Math.abs(derived[1]!.kmh - 40) < 2, String(derived[1]!.kmh)); // 11 m in a second
});

test("a limit the rider confirmed lowers a guess in the file, never a posted limit, and never raises it", async () => {
  const file = await roadbookFile();
  const [p] = proposeLowerLimits(
    file,
    ride((i) => (i < 30 ? 50 : 80)),
  );
  const { file: after } = await buildRoadbookFile(
    input,
    tracing([edge(0, 30), edge(30, 60, { speed_limit: 80 })]),
    undefined,
    undefined,
    correctedLimits([{ shape: p!.shape, kmh: 50 }]),
  );
  assert.deepEqual(
    after.limits.map((l) => [l.from, l.to, l.kmh, l.posted, l.source]),
    [
      [0, 30, 50, true, "ride"],
      [30, 60, 80, true, undefined],
    ],
  );
  // The correction sits on the road, so it lowers the posted stretch too only if the stretch is a guess: it is not.
  const { file: higher } = await buildRoadbookFile(
    input,
    tracing([edge(0, 30), edge(30, 60, { speed_limit: 80 })]),
    undefined,
    undefined,
    correctedLimits([{ shape: p!.shape, kmh: 90 }]),
  );
  assert.equal(higher.limits[0]!.kmh, 80, "a correction never raises a guess");
  // Turned down (kmh null) changes nothing in the file.
  assert.equal(correctedLimits([{ shape: p!.shape, kmh: null }]), undefined);
});

const gpxOf = (points: RidePoint[], name: string) =>
  `<?xml version="1.0"?><gpx version="1.1"><metadata><name>${name}, 2026-10-30</name><extensions><motoride:ride roadbook="r2-x" name="${name}" state="completed"/></extensions></metadata><trk><trkseg>${points
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.time).toISOString()}</time><extensions><motoride:speed>${(p.kmh / 3.6).toFixed(1)}</motoride:speed></extensions></trkpt>`,
    )
    .join("")}</trkseg></trk></gpx>`;

test("reviewing a recorded ride: found by name when it has no origin, proposals numbered, answers kept, then not proposed again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ride-review-"));
  const store = new Store(join(dir, "rides.db"));
  try {
    const { importRoadbookFile } = await import("../src/importRoadbook.ts");
    const { id } = importRoadbookFile(store, {
      format: "motoride-roadbook",
      version: 1,
      name: "Device loop",
      line: shapes[0],
      stops: [],
      limits: [],
      cameras: [],
    });
    // The file a server has ready for this roadbook (what a review compares with).
    mkdirSync(join(dir, "roadbooks-ready"));
    writeFileSync(join(dir, "roadbooks-ready", `${id}.json`), JSON.stringify(await roadbookFile()));
    keepRide(
      store,
      "ride-1",
      gpxOf(
        ride((i) => (i < 30 ? 50 : 80)),
        "Device loop",
      ),
    );
    assert.equal(store.listRecordedRides()[0]!.roadbook?.id, id, "linked by its name, there is only one");

    await runInContext({ fileRoot: dir }, async () => {
      const review = await reviewRecordedRide(store);
      assert.equal(review.proposals.length, 1);
      const said = formatRecordedReview(review);
      assert.match(said, /1\. D 955 near 50\.\d+,3\.\d+ \(\d\.\d km\): the roadbook guessed 80; you held 50/);
      assert.match(said, /Proposed: 50\./);
      assert.deepEqual(store.listLimitCorrections(), [], "nothing is kept before the rider answers");
      assert.equal(store.limitCorrectionsVersion(), "");

      assert.match(applyProposalDecisions(store, review, [{ n: 1, action: "confirm" }])[0]!, /50 instead of 80/);
      assert.equal(store.listLimitCorrections().length, 1);
      assert.notEqual(store.limitCorrectionsVersion(), "", "roadbook files made before are out of date");
      assert.match(applyProposalDecisions(store, review, [{ n: 9, action: "confirm" }])[0]!, /No proposal 9/);
      assert.match(applyProposalDecisions(store, review, [{ n: 1, action: "confirm", kmh: 100 }])[0]!, /not kept/);

      assert.equal(
        (await reviewRecordedRide(store)).proposals.length,
        0,
        "a place already corrected is not proposed again",
      );
    });
    const ride1 = store.findRide(String(id))!;
    assert.notEqual(rideStamp(ride1, "", ""), rideStamp(ride1, "", store.limitCorrectionsVersion()));
    assert.equal(rideStamp(ride1, ""), rideStamp(ride1, "", ""), "no corrections: the stamp it always had");
  } finally {
    store.close();
  }
});

test("a rejected proposal is not proposed again, and a ride with no roadbook has nothing to compare", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ride-review-"));
  const store = new Store(join(dir, "rides.db"));
  try {
    const { importRoadbookFile } = await import("../src/importRoadbook.ts");
    const { id } = importRoadbookFile(store, {
      format: "motoride-roadbook",
      version: 1,
      name: "Device loop",
      line: shapes[0],
      stops: [],
      limits: [],
      cameras: [],
    });
    mkdirSync(join(dir, "roadbooks-ready"));
    writeFileSync(join(dir, "roadbooks-ready", `${id}.json`), JSON.stringify(await roadbookFile()));
    keepRide(
      store,
      "ride-1",
      gpxOf(
        ride((i) => (i < 30 ? 50 : 80)),
        "Device loop",
      ),
    );
    keepRide(
      store,
      "free",
      gpxOf(
        ride(() => 50),
        "Somewhere else",
      ),
    );
    await runInContext({ fileRoot: dir }, async () => {
      const review = await reviewRecordedRide(store, "ride-1");
      applyProposalDecisions(store, review, [{ n: 1, action: "reject" }]);
      assert.equal((await reviewRecordedRide(store, "ride-1")).proposals.length, 0);
      assert.equal(store.limitCorrectionsVersion(), "", "a rejection changes no roadbook file");
      const free = await reviewRecordedRide(store, "free");
      assert.match(formatRecordedReview(free), /nothing to compare it with/);
      await assert.rejects(reviewRecordedRide(store, "no-such"), /No recorded ride matches/);
    });
  } finally {
    store.close();
  }
});

test("a guessed stretch that covers two real zones is cut: only the part ridden steadily low is proposed", async () => {
  // One guessed 80 over the whole line; the rider is in a village (50) for the first half and on open road (80) after.
  const { file } = await buildRoadbookFile(input, tracing([edge(0, 60)]));
  assert.equal(file.limits.length, 1);
  const proposals = proposeLowerLimits(
    file,
    ride((i) => (i < 40 ? 49 + (i % 3) : 80)),
  );
  assert.equal(proposals.length, 1);
  assert.deepEqual([proposals[0]!.from, proposals[0]!.to, proposals[0]!.proposed], [0, 40, 50]);
  assert.ok(decodePolyline(proposals[0]!.shape).length <= 41, "the correction covers the village only");
  // Applied, the open road keeps its guess (the roadbook's edges end where the village does).
  const { file: after } = await buildRoadbookFile(
    input,
    tracing([edge(0, 40), edge(40, 60)]),
    undefined,
    undefined,
    correctedLimits([{ shape: proposals[0]!.shape, kmh: 50 }]),
  );
  assert.deepEqual(
    after.limits.map((l) => [l.from, l.kmh, l.source]),
    [
      [0, 50, "ride"],
      [40, 80, undefined],
    ],
  );
});

test("a confirmed correction does not lower an edge it covers only in part", async () => {
  const { file } = await buildRoadbookFile(input, tracing([edge(0, 60)]));
  const [p] = proposeLowerLimits(
    file,
    ride((i) => (i < 40 ? 50 : 80)),
  );
  const { file: after } = await buildRoadbookFile(
    input,
    tracing([edge(0, 60)]),
    undefined,
    undefined,
    correctedLimits([{ shape: p!.shape, kmh: 50 }]),
  );
  assert.deepEqual(
    after.limits.map((l) => [l.from, l.to, l.kmh]),
    [[0, 60, 80]],
    "one edge of 60 points, a correction on 40 of them: the guess stays, as before",
  );
});
