// Live check of each tool against the real public APIs, without calling Claude.
import { searchRoads } from "../src/tools/roads.ts";
import { getTraffic } from "../src/tools/traffic.ts";
import { calculateTrip } from "../src/tools/trip.ts";
import { getDaylight, getWeather } from "../src/tools/weather.ts";
import { speedCamerasAlong, stopsAlong } from "../src/tools/along.ts";
import { computeTrip } from "../src/tools/trip.ts";

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const checks: Array<[string, () => Promise<unknown>]> = [
  ["getWeather", () => getWeather({ location: "Florac, France", date: tomorrow, fromHour: 9, toHour: 12 })],
  ["searchRoads", () => searchRoads({ location: "Florac, France", radiusKm: 15, limit: 5 })],
  ["calculateTrip", () => calculateTrip({ waypoints: ["Mende", "Florac, France", "Meyrueis"], roundTrip: true })],
  ["getDaylight", () => getDaylight({ location: "Florac, France", date: "2027-06-21" })],
  ["speedCameras+stops", async () => { const t = await computeTrip({ waypoints: ["Mende", "Florac, France"], roundTrip: true }); const c = await speedCamerasAlong(t.shapes, t.result.legs); const s: any = await stopsAlong(t.shapes, t.result.legs, ["fuel"], 400, 5); return { cameras: c.count, fuel: s.fuel.found }; }],
  ["getTraffic", () => getTraffic({ waypoints: ["Mende", "Florac, France"], departAt: `${tomorrow}T09:00:00` })],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    console.log(`\n=== ${name}\n${JSON.stringify(await run(), null, 1).slice(0, 1800)}`);
  } catch (error) {
    failed++;
    console.error(`\n=== ${name} FAILED: ${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed ? 1 : 0);
