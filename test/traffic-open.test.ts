import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEED_MS,
  lambert93ToWgs84,
  metresToSection,
  openData,
  parseSpeeds,
  parseStations,
  SpeedMemory,
} from "../src/traffic-open.ts";

const near = (a: number, b: number, tol: number) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("Lambert-93 gives the origin of the projection and a town of the A28", () => {
  const [lat0, lon0] = lambert93ToWgs84(700000, 6600000);
  near(lat0, 46.5, 1e-6);
  near(lon0, 3, 1e-6);
  const [lat, lon] = lambert93ToWgs84(569981.6, 6938140); // the first station of the list, near Rouen
  near(lat, 49.4, 0.15);
  near(lon, 1.08, 0.15);
});

const CSV = [
  "code_pme;source;source_2;code_insee_commune;axe;pr_debut;abscisse_debut;pr_fin;abscisse_fin;sens_gestionnaire;sens_cardinal;sens_migratoire;sens_giratoire;longueur;nb_voies;x_deb;y_deb;x_fin;y_fin;code_traficolor",
  "S1;DIRNO;1;A28;76PR91D;800;76PR94D;840;1;NORD_SUD;Y;;3035;0;569981.6;6938140.0;568217.6;6935783.5;RO76",
  "S2;DIRN;;;;0;;;;;;;0;0;;;;;",
].join("\n");

const feed = (time: string, entries: Array<[string, string]>) =>
  `<d2LogicalModel><payloadPublication><publicationTime>${time}</publicationTime>` +
  entries
    .map(
      ([id, speed]) =>
        `<siteMeasurements><measurementSiteReference targetClass="MeasurementSiteRecord" id="${id}" version="1.0"/>` +
        `<measuredValue index="0"><measuredValue><basicData xsi:type="TrafficFlow"><vehicleFlow><vehicleFlowRate>900</vehicleFlowRate></vehicleFlow></basicData></measuredValue></measuredValue>` +
        `<measuredValue index="0"><measuredValue><basicData xsi:type="TrafficSpeed"><averageVehicleSpeed numberOfInputValuesUsed="9"><speed>${speed}</speed></averageVehicleSpeed></basicData></measuredValue></measuredValue></siteMeasurements>`,
    )
    .join("") +
  `</payloadPublication></d2LogicalModel>`;

test("the stations that have a position are kept, the others left out", () => {
  const stations = parseStations(CSV);
  assert.equal(stations.length, 1);
  assert.equal(stations[0]!.id, "S1");
});

test("the speeds are read per station and the feed's 'no measure' is dropped", () => {
  const r = parseSpeeds(
    feed("2026-10-23T10:48:00+02:00", [
      ["S1", "77.0"],
      ["S2", "9999999.0"],
    ]),
  );
  assert.equal(r.time, "2026-10-23T10:48:00+02:00");
  assert.deepEqual([...r.speeds], [["S1", 77]]);
});

test("the distance to a section is zero on it and grows away from it", () => {
  const s = parseStations(CSV)[0]!;
  const mid: [number, number] = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  near(metresToSection(mid[0], mid[1], s), 0, 1);
  const far = metresToSection(mid[0] + 0.05, mid[1], s);
  assert.ok(far > 3000 && far < 6000, String(far));
});

test("a station's speed means nothing until enough has been seen, then it is read against its usual speed", () => {
  const m = new SpeedMemory();
  for (let i = 0; i < 11; i++) m.add("S1", 90);
  assert.equal(m.ratio("S1", 40), null);
  m.add("S1", 90);
  assert.equal(m.ratio("S1", 90), 1);
  assert.equal(m.ratio("S1", 45), 0.5);
  assert.equal(m.ratio("other", 45), null);
});

test("the provider answers from the feed: unknown while learning, then the level, and nothing outside France", async () => {
  let t = 0;
  let n = 0;
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    if (url.endsWith("refDir.csv")) return CSV;
    n++;
    // Thirteen free readings, then a jam.
    return feed(`2026-10-23T10:${String(n).padStart(2, "0")}:00+02:00`, [["S1", n <= 13 ? "90.0" : "30.0"]]);
  };
  const provider = openData({ now: () => t, get });
  const s = parseStations(CSV)[0]!;
  const [lat, lon] = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  assert.deepEqual(await provider.flowAt(lat, lon), { level: "unknown", ratio: null });
  for (let i = 0; i < 11; i++) {
    t += FEED_MS;
    await provider.flowAt(lat, lon);
  }
  t += FEED_MS;
  assert.deepEqual(await provider.flowAt(lat, lon), { level: "free", ratio: 1 });
  t += FEED_MS;
  const jam = await provider.flowAt(lat, lon);
  assert.equal(jam.level, "heavy");
  assert.deepEqual(await provider.flowAt(40, 3), { level: "unknown", ratio: null }); // Spain: not covered
  assert.deepEqual(await provider.flowAt(lat + 0.1, lon), { level: "unknown", ratio: null }); // nowhere near a station
  assert.deepEqual(provider.countries, ["FR"]);
});

test("many riders in five minutes read the feed once, and a feed that is down says unknown and tries again", async () => {
  const t = 0;
  let reads = 0;
  let down = true;
  const get = async (url: string) => {
    if (url.endsWith("refDir.csv")) return CSV;
    reads++;
    if (down) throw new Error("down");
    return feed("2026-10-23T10:00:00+02:00", [["S1", "90.0"]]);
  };
  const provider = openData({ now: () => t, get });
  const s = parseStations(CSV)[0]!;
  const [lat, lon] = s.a;
  assert.equal((await provider.flowAt(lat, lon)).level, "unknown");
  down = false;
  await provider.flowAt(lat, lon);
  await Promise.all([provider.flowAt(lat, lon), provider.flowAt(lat, lon), provider.flowAt(lat, lon)]);
  assert.equal(reads, 2); // the failed read and the one that worked: the four riders after it shared it
});
