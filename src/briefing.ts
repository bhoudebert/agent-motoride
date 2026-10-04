import { formatWeather, replanStops, rideWeatherFor } from "./library.ts";
import { formatStopPlan } from "./stops.ts";
import type { SavedRide, Store } from "./store.ts";
import { getTraffic } from "./tools/traffic.ts";
import { getDaylight } from "./tools/weather.ts";

const hhmmToMin = (t: string) => {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
};
const minToHhmm = (m: number) =>
  `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The next dated ride on or after today, else the most recently saved one. */
export function pickRideForToday(store: Store, today: string): SavedRide | undefined {
  const rides = store.listRides();
  const upcoming = rides
    .filter((r) => r.rideDate && r.rideDate >= today)
    .sort((a, b) => a.rideDate!.localeCompare(b.rideDate!));
  return upcoming[0] ?? rides.at(-1);
}

/**
 * Everything that can change between planning and riding, checked now:
 * forecast along the route, daylight, traffic at departure, and the stops
 * re-planned with opening hours at arrival. Ends with go, caution or no-go.
 */
export async function rideBriefing(store: Store, ride: SavedRide, today: string): Promise<string> {
  const lines: string[] = [];
  const problems: string[] = [];
  const cautions: string[] = [];
  const date = ride.rideDate ?? today;
  const departure = ride.departure ?? "09:00";
  lines.push(
    `Briefing for ride #${ride.id} "${ride.name}", ${date}, departure ${departure} from ${ride.home}`,
    `${ride.distanceKm} km, ${Math.floor(ride.ridingMinutes / 60)}h${String(ride.ridingMinutes % 60).padStart(2, "0")} riding estimated`,
    "",
  );
  if (!ride.rideDate) cautions.push("The ride has no date; today is assumed.");

  // Daylight and return time.
  let lastLight: string | null = null;
  try {
    const d = await getDaylight({ location: ride.home, date });
    lastLight = d.lastLight;
    lines.push(`Daylight: sunrise ${d.sunrise}, sunset ${d.sunset}, usable light ${d.firstLight} to ${d.lastLight}`);
  } catch (error) {
    cautions.push(`Daylight could not be computed (${error instanceof Error ? error.message.slice(0, 80) : error}).`);
  }

  // Stops, with opening hours at arrival on this date.
  let breaks = 0;
  if (ride.shapes) {
    try {
      const extras = await replanStops(store, ride);
      if (extras?.stopPlan) {
        lines.push("", ...formatStopPlan(extras.stopPlan, departure, ride.ridingMinutes));
        breaks = extras.stopPlan.stops.reduce(
          (sum, s) => sum + (s.kind === "lunch" ? 45 : s.kind === "fuel" ? 10 : 15),
          0,
        );
        for (const s of extras.stopPlan.stops)
          if (s.openAtArrival === "closed") problems.push(`${s.name} is closed at ${s.eta}.`);
        for (const w of extras.stopPlan.warnings) if (!w.includes("closed at")) cautions.push(w);
      }
    } catch (error) {
      cautions.push(`Stops could not be checked (${error instanceof Error ? error.message.split(".")[0] : error}).`);
    }
  } else cautions.push("No route line stored for this ride; run a full refresh for stops and weather along the route.");

  const back = minToHhmm(hhmmToMin(departure) + ride.ridingMinutes + breaks);
  if (lastLight) {
    lines.push("", `Back around ${back} with breaks; last usable light ${lastLight}`);
    if (hhmmToMin(back) > hhmmToMin(lastLight))
      problems.push(`Return at ${back} is after the last light at ${lastLight}.`);
    else if (hhmmToMin(back) > hhmmToMin(lastLight) - 45)
      cautions.push(`Return at ${back} is within 45 min of the last light at ${lastLight}.`);
  }

  // Weather along the route for the riding hours.
  if (ride.shapes) {
    try {
      const weather = await rideWeatherFor(store, ride);
      if (weather) {
        lines.push("", ...formatWeather(weather, date));
        const wet = weather.points.filter((p) => !p.dry);
        if (wet.length) {
          const worst = wet.sort((a, b) => b.maxRainProbPct - a.maxRainProbPct)[0]!;
          (worst.maxRainProbPct >= 50 || worst.totalRainMm >= 1 ? problems : cautions).push(
            `Rain risk at ${wet.map((p) => p.label).join(", ")}: up to ${worst.maxRainProbPct}% and ${worst.totalRainMm} mm.`,
          );
        }
        const gust = Math.max(...weather.points.map((p) => p.maxGustKmh));
        if (gust >= 60) problems.push(`Gusts up to ${gust} km/h.`);
        else if (gust >= 45) cautions.push(`Gusts up to ${gust} km/h.`);
        const cold = Math.min(...weather.points.map((p) => p.minTempC));
        if (cold <= 3) cautions.push(`Temperatures down to ${cold} °C: watch for ice in shade.`);
      } else cautions.push(`No forecast yet: ${date} is beyond the 16-day range.`);
    } catch (error) {
      cautions.push(`Weather could not be fetched (${error instanceof Error ? error.message.slice(0, 80) : error}).`);
    }
  }

  // Traffic at departure.
  try {
    const traffic = await getTraffic({
      waypoints: ride.waypoints,
      departAt: `${date}T${departure.padStart(5, "0")}:00`,
      roundTrip: ride.roundTrip,
      avoidMotorways: ride.preferences.avoidMotorways,
    });
    if (traffic.available === false) lines.push("", `Traffic: not checked (${traffic.reason})`);
    else {
      lines.push(
        "",
        `Traffic at ${departure}: ${traffic.travelMinutes} min with traffic, delay ${traffic.trafficDelayMinutes} min`,
      );
      if ((traffic.trafficDelayMinutes ?? 0) >= 20) cautions.push(`Traffic adds ${traffic.trafficDelayMinutes} min.`);
    }
  } catch (error) {
    cautions.push(`Traffic could not be checked (${error instanceof Error ? error.message.slice(0, 80) : error}).`);
  }

  // Cameras, from the stored extras.
  const cams = ride.extras?.cameras ?? [];
  lines.push(
    "",
    cams.length
      ? `Fixed cameras: ${cams.length}, at km ${[...new Set(cams.map((c) => c.kmAlongRoute))].join(", ")}`
      : "Fixed cameras: none mapped on the route",
  );

  lines.push(
    "",
    problems.length ? "NO-GO as planned:" : cautions.length ? "GO with caution:" : "GO: nothing in the way.",
  );
  for (const p of problems) lines.push(`  ! ${p}`);
  for (const c of cautions) lines.push(`  - ${c}`);
  return lines.join("\n");
}
