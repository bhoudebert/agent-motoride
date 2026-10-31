import assert from "node:assert/strict";
import { test } from "node:test";
import { builtUpFrom } from "../src/builtUp.ts";
import { buildRoadbookFile } from "../src/roadbookFile.ts";
import {
  axisAngle,
  kmhOfSign,
  MAX_AGE_MS,
  metresToSegment,
  signLimitFrom,
  signsToken,
  type Sign,
  type SignLookup,
} from "../src/signs.ts";
import { bearingDeg } from "../src/tools/geo.ts";
import { bentLine, encodePolyline } from "./helpers/polyline.ts";

const A = { lat: 50.4, lon: 3.0 };
const B = { lat: 50.6, lon: 3.4 };
const line = bentLine(A, B, 61, 0.02);
const NOW = Date.UTC(2026, 9, 31);
const brg = bearingDeg(line[10]!, line[11]!);
/** A sign beside segment 10 of the line, `metres` to the side of it. */
const sign = (extra: Partial<Sign> = {}, metres = 5): Sign => ({
  lat: line[10]!.lat,
  lon: line[10]!.lon + metres / (111_320 * Math.cos((line[10]!.lat * Math.PI) / 180)),
  kmh: 70,
  seenAt: NOW - 30 * 24 * 3600 * 1000,
  facing: brg,
  ...extra,
});
const limit = (signs: Sign[], works: Array<{ lat: number; lon: number }> = []) => signLimitFrom(signs, works, NOW);

test("sign values: only maximum speed limits in whole tens read as a limit", () => {
  assert.equal(kmhOfSign("regulatory--maximum-speed-limit-50--g1"), 50);
  assert.equal(kmhOfSign("regulatory--maximum-speed-limit-130--g1"), 130);
  assert.equal(kmhOfSign("regulatory--maximum-speed-limit-15--g3"), null);
  assert.equal(kmhOfSign("regulatory--end-of-maximum-speed-limit-50--g1"), null);
  assert.equal(kmhOfSign("regulatory--no-entry--g1"), null);
});

test("sign geometry: distance to a segment and the angle between two directions as lines", () => {
  const a = { lat: 50, lon: 3 };
  const b = { lat: 50, lon: 3.01 };
  assert.ok(Math.abs(metresToSegment({ lat: 50.0001, lon: 3.005 }, a, b) - 11.1) < 0.5);
  assert.ok(metresToSegment({ lat: 50, lon: 3.02 }, a, b) > 600);
  assert.equal(axisAngle(10, 190), 0);
  assert.equal(axisAngle(350, 10), 20);
  assert.equal(axisAngle(0, 90), 90);
});

test("a sign beside the road gives the limit of the stretch it stands on, and only that one", () => {
  const at = limit([sign()]);
  assert.equal(at(line, 0, 30), 70);
  assert.equal(at(line, 30, 60), null);
});

test("a sign facing the other way along the road counts: a limit holds both ways", () => {
  assert.equal(limit([sign({ facing: (brg + 180) % 360 })])(line, 0, 30), 70);
});

test("a sign facing across the road is a side road's and is ignored", () => {
  assert.equal(limit([sign({ facing: (brg + 90) % 360 })])(line, 0, 30), null);
  assert.equal(limit([sign({ facing: null })])(line, 0, 30), null);
});

test("a sign far from the road is another road's", () => {
  assert.equal(limit([sign({}, 30)])(line, 0, 30), null);
});

test("a sign next to road works markers is temporary and ignored; far works do not matter", () => {
  const s = sign();
  assert.equal(limit([s], [{ lat: s.lat, lon: s.lon + 0.0003 }])(line, 0, 30), null);
  assert.equal(limit([s], [{ lat: s.lat + 0.01, lon: s.lon }])(line, 0, 30), 70);
});

test("a sign not seen for two years is not trusted", () => {
  assert.equal(limit([sign({ seenAt: NOW - MAX_AGE_MS - 1 })])(line, 0, 30), null);
  assert.equal(limit([sign({ seenAt: NOW - MAX_AGE_MS + 1000 })])(line, 0, 30), 70);
});

test("signs that disagree on a stretch give no limit; signs that agree give it", () => {
  assert.equal(limit([sign(), sign({ kmh: 50 })])(line, 0, 30), null);
  assert.equal(limit([sign(), sign({ facing: (brg + 180) % 360 })])(line, 0, 30), 70);
});

test("the sign service is off without a token", () => {
  assert.equal(signsToken({}), null);
  assert.equal(signsToken({ MAPILLARY_ACCESS_TOKEN: "  " }), null);
  assert.equal(signsToken({ MAPILLARY_ACCESS_TOKEN: " MLY|1|abc " }), "MLY|1|abc");
});

const legs = [{ from: "Home", to: "Mont", fromCoords: "50.4,3", toCoords: "50.6,3.4" }];
const FR = [{ country_code: "FR", state_code: "HDF" }];
const edge = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
  length: 20,
  road_class: "secondary",
  density: 2,
  names: ["N 507"],
  begin_shape_index: from,
  end_shape_index: to,
  end_node: { admin_index: 0 },
  ...extra,
});
const tracing = (edges: unknown[]) => async (shape: string) => ({ shape, admins: FR, edges: edges as any[] });
const input = { name: "Loop", description: "", legs, shapes: [encodePolyline(line)] };
const withSign: SignLookup = async () => (_points, _from, to) => (to <= 30 ? 70 : null);

test("roadbook file: a sign fills a stretch OSM does not know, marked as from a sign", async () => {
  const { file, signDisagreements } = await buildRoadbookFile(
    input,
    tracing([edge(0, 30), edge(30, 60)]),
    undefined,
    withSign,
  );
  assert.deepEqual(
    file.limits.map((l) => [l.from, l.to, l.kmh, l.posted, l.source]),
    [
      [0, 30, 70, true, "sign"],
      [30, 60, 80, false, undefined],
    ],
  );
  assert.deepEqual(signDisagreements, []);
});

test("roadbook file: OpenStreetMap's posted limit is kept; a sign that says otherwise is only reported, once", async () => {
  const { file, signDisagreements } = await buildRoadbookFile(
    input,
    tracing([edge(0, 10, { speed_limit: 90 }), edge(10, 30, { speed_limit: 90 }), edge(30, 60, { speed_limit: 90 })]),
    undefined,
    withSign,
  );
  assert.deepEqual(
    file.limits.map((l) => [l.from, l.to, l.kmh, l.posted, l.source]),
    [[0, 60, 90, true, undefined]],
    "the posted 90 stays whatever the sign says",
  );
  assert.equal(signDisagreements.length, 1);
  assert.match(signDisagreements[0]!, /N 507 near 50\.\d+,3\.\d+: sign says 70, OSM says 90/);
});

test("roadbook file: a sign agreeing with OSM is nothing to report", async () => {
  const { signDisagreements } = await buildRoadbookFile(
    input,
    tracing([edge(0, 30, { speed_limit: 70 })]),
    undefined,
    withSign,
  );
  assert.deepEqual(signDisagreements, []);
});

test("roadbook file: a roundabout's ring takes no sign", async () => {
  const { file } = await buildRoadbookFile(input, tracing([edge(0, 30, { roundabout: true })]), undefined, withSign);
  assert.equal(file.limits[0]!.source, undefined);
  assert.equal(file.limits[0]!.kmh, 80);
});

test("roadbook file: a sign comes before the built-up guess", async () => {
  const ring = [
    { lat: 50, lon: 2 },
    { lat: 50, lon: 4 },
    { lat: 51, lon: 4 },
    { lat: 51, lon: 2 },
    { lat: 50, lon: 2 },
  ];
  const { file } = await buildRoadbookFile(
    input,
    tracing([edge(0, 30), edge(30, 60)]),
    async () => builtUpFrom([ring]),
    withSign,
  );
  assert.deepEqual(
    file.limits.map((l) => [l.kmh, l.source]),
    [
      [70, "sign"],
      [50, "inferred"],
    ],
  );
});

test("roadbook file: when the sign service fails the guesses stand and the file says so", async () => {
  const { file, signsError } = await buildRoadbookFile(input, tracing([edge(0, 60)]), undefined, async () => {
    throw new Error("Mapillary is down");
  });
  assert.equal(file.limits[0]!.kmh, 80);
  assert.match(signsError ?? "", /Road signs not checked \(Mapillary is down\)/);
});

test("roadbook file: without a sign lookup nothing changes", async () => {
  const { file, signsError, signDisagreements } = await buildRoadbookFile(input, tracing([edge(0, 60)]));
  assert.equal(file.limits[0]!.source, undefined);
  assert.equal(signsError, null);
  assert.deepEqual(signDisagreements, []);
});

const flat = [
  { lat: 10, lon: 10 },
  { lat: 10, lon: 10.01 },
];
const recent = () => new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const feature = (id: string, value: string, lat: number, lon: number) => ({
  id,
  object_value: value,
  last_seen_at: recent(),
  geometry: { type: "Point", coordinates: [lon, lat] },
});

test("Mapillary: signs are read per map cell, facing only for signs by the line, and works markers hide temporary ones", async (t) => {
  const asked: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const u = String(url);
    asked.push(u);
    if (u.includes("/map_features")) {
      return new Response(
        JSON.stringify({
          data: [
            feature("a", "regulatory--maximum-speed-limit-70--g1", 10.00005, 10.005),
            feature("b", "regulatory--maximum-speed-limit-30--g1", 10, 10.008),
            feature("far", "regulatory--maximum-speed-limit-50--g1", 10.001, 10.003),
            feature("odd", "regulatory--maximum-speed-limit-15--g3", 10, 10.002),
            feature("w", "warning--roadworks--g1", 10, 10.0081),
            { id: "nogeo", object_value: "regulatory--maximum-speed-limit-90--g1" },
          ],
        }),
      );
    }
    return new Response(JSON.stringify({ aligned_direction: 90 }));
  });
  const limit = await (await import("../src/signs.ts")).mapillarySigns("MLY|1|secret")(flat);
  assert.equal(limit(flat, 0, 1), 70);
  const cellRequest = asked.find((u) => u.includes("/map_features"))!;
  assert.match(cellRequest, /bbox=10\.0000,10\.0000,10\.0500,10\.0500/);
  assert.match(cellRequest, /object_values=regulatory--maximum-speed-limit\*%2Cwarning--roadworks\*/);
  assert.match(cellRequest, /access_token=MLY%7C1%7Csecret/);
  // Facing is asked for the two signs by the line (a, b), not for the one 110 m away or the 15 km/h one.
  assert.deepEqual(
    asked.filter((u) => !u.includes("/map_features")).map((u) => /graph\.mapillary\.com\/(\w+)\?/.exec(u)![1]),
    ["a", "b"],
  );
});

test("Mapillary: a failed map cell is not kept, so the next export asks again, and the token never reaches the message", async (t) => {
  let calls = 0;
  const line = [
    { lat: 20, lon: 20 },
    { lat: 20, lon: 20.01 },
  ];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request) => {
    calls++;
    if (calls === 1) return new Response("down", { status: 503 });
    return new Response(JSON.stringify({ data: [] }));
  });
  const lookup = (await import("../src/signs.ts")).mapillarySigns("MLY|2|secret");
  await assert.rejects(
    () => lookup(line),
    (e: Error) => /503/.test(e.message) && !e.message.includes("secret"),
  );
  assert.equal((await lookup(line))(line, 0, 1), null);
});

test("Mapillary: a sign whose facing cannot be read is ignored", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) =>
    String(url).includes("/map_features")
      ? new Response(
          JSON.stringify({ data: [feature("z", "regulatory--maximum-speed-limit-70--g1", 30.00005, 30.005)] }),
        )
      : new Response("nope", { status: 500 }),
  );
  const line = [
    { lat: 30, lon: 30 },
    { lat: 30, lon: 30.01 },
  ];
  assert.equal((await (await import("../src/signs.ts")).mapillarySigns("t")(line))(line, 0, 1), null);
});

test("Mapillary: the lookup exists only with a token", async () => {
  const { configuredSigns } = await import("../src/signs.ts");
  assert.equal(configuredSigns({}), undefined);
  assert.equal(typeof configuredSigns({ MAPILLARY_ACCESS_TOKEN: "x" }), "function");
});
