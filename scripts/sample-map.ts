// The example ride map of the site and the guide: replays a recorded eval session
// (a loop from Namur, planned live) offline and draws the map of the ride it planned.
//   node scripts/sample-map.ts   writes site/ride-map.png and docs/guide/public/ride-map.png
process.env.ANTHROPIC_API_KEY = "replay-no-network";
process.env.RIDE_SCOUTS = "1";
process.env.RIDE_MODEL = "claude-sonnet-5-5";
process.env.RIDE_EFFORT = "medium";
process.env.TOMTOM_API_KEY = "replay-redacted";
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { readCassette, replay } = await import(`${root}/evals/cassette.ts`);
const { CASES } = await import(`${root}/evals/cases.ts`);
const { openRide } = await import(`${root}/src/agent.ts`);
const { saveCurrentRide } = await import(`${root}/src/library.ts`);
const { registerRoute } = await import(`${root}/src/session.ts`);
const { computeTrip } = await import(`${root}/src/tools/trip.ts`);
const { resetGeoState } = await import(`${root}/src/tools/geo.ts`);
const { Store } = await import(`${root}/src/store.ts`);
const { DEFAULT_PREFERENCES } = await import(`${root}/src/preferences.ts`);
const { rideMapPng } = await import(`${root}/src/rideMap.ts`);
const id = "rated-never-again";
const c = CASES.find((k: any) => k.id === id)!;
const cassette = readCassette(`${root}/evals/cassettes/${id}.json.gz`);
resetGeoState();
const tape = replay(cassette);
const log = console.log;
console.log = () => undefined;
const store = new Store(":memory:");
const now = new Date(cassette.now);
const preferences = { ...DEFAULT_PREFERENCES, ...c.preferences };
for (const seed of c.seed ?? []) {
  const setup = await openRide({ home: c.home, store, preferences, now });
  const trip = await computeTrip({ waypoints: seed.waypoints, roundTrip: true, avoidMotorways: true });
  const r = registerRoute(setup.context, trip);
  const sid = saveCurrentRide(
    setup.context,
    { route: r, rideDate: null, departure: null, title: seed.name, itinerary: "" },
    { request: "seed", parentId: null, home: c.home, force: true },
  );
  if (seed.rating !== undefined) store.rateRide(sid, seed.rating, null);
}
const session = await openRide({ home: c.home, store, preferences, now });
await session.send(c.request);
console.log = log;
tape.restore();
const current = session.current()!;
const trace = store.listTrace(session.context.runId);
const out = (name: string) =>
  (trace.findLast((e: any) => e.kind === "tool" && e.name === name)?.payload as any)?.output;
const rideId = saveCurrentRide(session.context, current, {
  request: c.request,
  parentId: null,
  home: c.home,
  force: true,
});
const plan = out("planStops");
store.setExtras(rideId, {
  gatheredAt: now.toISOString(),
  daylight: null,
  errors: {},
  stops: {},
  cameras: out("getSpeedCameras")?.cameras ?? [],
  stopPlan: plan
    ? { date: plan.date, fuelAtStartKm: plan.fuelAtStartKm, warnings: plan.warnings, stops: plan.stops }
    : null,
});
const ride = store.findRide(String(rideId))!;
log(
  ride.name,
  ride.distanceKm,
  "km,",
  ride.extras?.cameras.length,
  "cameras,",
  ride.extras?.stopPlan?.stops.length,
  "stops |",
  ride.legs.map((l: any) => l.to).join(" > "),
);
const { mkdirSync, writeFileSync } = await import("node:fs");
const png = rideMapPng(ride);
for (const file of [`${root}/site/ride-map.png`, `${root}/docs/guide/public/ride-map.png`]) {
  mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  writeFileSync(file, png);
}
