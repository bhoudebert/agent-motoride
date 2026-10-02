// Live check of each tool against the real public APIs, without calling Claude.
import { searchRoads } from "../src/tools/roads.ts";
import { getTraffic } from "../src/tools/traffic.ts";
import { calculateTrip } from "../src/tools/trip.ts";
import { getWeather } from "../src/tools/weather.ts";

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const checks: Array<[string, () => Promise<unknown>]> = [
  ["getWeather", () => getWeather({ location: "Florac, France", date: tomorrow, fromHour: 9, toHour: 12 })],
  ["searchRoads", () => searchRoads({ location: "Florac, France", radiusKm: 15, limit: 5 })],
  ["calculateTrip", () => calculateTrip({ waypoints: ["Mende", "Florac, France", "Meyrueis"], roundTrip: true })],
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
