// Manage the saved-ride library without starting a planning session.
import { routeCells } from "./geometry.ts";
import { exportSavedRide } from "./gpx.ts";
import { formatRideDetail, formatRideList, parseRating, tripFigures } from "./library.ts";
import { Store } from "./store.ts";
import { formatTrace } from "./trace.ts";
import { setGeoAnchor } from "./tools/geo.ts";
import { computeTrip } from "./tools/trip.ts";

const USAGE = `Usage: npm run rides -- <command>

  list                                  All saved rides
  show <id|name>                        One ride: legs, map link, itinerary
  rate <id|name> <1-5> [note]           Rate a ride after riding it
  rate-leg <id|name> <leg> <1-5> [note] Rate one leg of a ride
  export <id|name> [file.gpx]           Write the ride as a GPX file (default: exports/ in the project)
  trace <run> [--full]                  Replay a planning session step by step (run ids from "runs")
  runs [--csv]                          Every planning session with model, effort, tokens, cost and result
  refresh <id|name|all>                 Route a saved ride again and update its distance, times and road mix
  delete <id|name>                      Remove a ride and its legs
  clear-cache                           Drop cached road, route and weather lookups

Ratings steer later planning: legs and rides rated 4-5 are reused as building
blocks, those rated 1-2 are avoided.`;

const [command, ...args] = process.argv.slice(2);
const store = new Store();

function ride(idOrName: string | undefined) {
  if (!idOrName) throw new Error("Which ride? Give its id or name.");
  const found = store.findRide(idOrName);
  if (!found) throw new Error(`No saved ride matches "${idOrName}". Run: npm run rides -- list`);
  return found;
}

try {
  switch (command) {
    case "list":
      console.log(formatRideList(store.listRides()));
      break;
    case "show":
      console.log(formatRideDetail(ride(args[0])));
      break;
    case "rate": {
      const target = ride(args[0]);
      const { rating, notes } = parseRating(args.slice(1));
      store.rateRide(target.id, rating, notes);
      console.log(`Rated #${target.id} "${target.name}" ${rating}/5.`);
      break;
    }
    case "rate-leg": {
      const target = ride(args[0]);
      const seq = Number(args[1]);
      const { rating, notes } = parseRating(args.slice(2));
      if (!store.rateLeg(target.id, seq, rating, notes)) {
        throw new Error(`Ride #${target.id} has no leg ${args[1] ?? ""}; it has legs 1 to ${target.legs.length}.`);
      }
      console.log(`Rated leg ${seq} of #${target.id} "${target.name}" ${rating}/5.`);
      break;
    }
    case "export": {
      const target = ride(args[0]);
      const { path, rerouted } = await exportSavedRide(store, target, args[1]);
      console.log(`GPX written: ${path}${rerouted ? "\n(Route line was not stored for this ride; it was routed again from its waypoints.)" : ""}`);
      break;
    }
    case "trace": {
      const id = Number(args[0]);
      const run = Number.isInteger(id) ? store.findRun(id) : undefined;
      if (!run) throw new Error(`Which run? Give a run id from: npm run rides -- runs`);
      console.log(formatTrace(run, store.listTrace(run.id), args.includes("--full")));
      break;
    }
    case "runs": {
      const runs = store.listRuns();
      const csv = args.includes("--csv");
      const header = ["run", "date", "model", "effort", "turns", "calls", "tools", "in", "cache", "out", "secs", "cost", "km", "ride_min", "open%", "50%", "30%", "ride", "status", "request"];
      const rows = runs.map((run) => {
        const u = run.usage;
        return [
          run.id,
          run.startedAt.slice(0, 16).replace("T", " "),
          u.model.replace(/^claude-/, ""),
          u.effort,
          u.turns,
          u.modelCalls,
          u.toolCalls,
          u.inputTokens + u.cacheWriteTokens,
          u.cacheReadTokens,
          u.outputTokens,
          Math.round(u.seconds),
          run.costUsd === null ? "?" : csv ? run.costUsd.toFixed(4) : `$${run.costUsd.toFixed(2)}`,
          run.result?.distanceKm ?? "-",
          run.result?.ridingMinutes ?? "-",
          run.result?.openRoadPct ?? "-",
          run.result?.pct50 ?? "-",
          run.result?.pct30 ?? "-",
          run.rideId ? `#${run.rideId}` : "-",
          run.error ? "FAILED" : run.result ? "ok" : "no ride",
          csv ? run.request : run.request.slice(0, 40),
        ].map(String);
      });
      if (csv) {
        const quote = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
        console.log([header, ...rows].map((row) => row.map(quote).join(",")).join("\n"));
      } else if (rows.length === 0) {
        console.log("No planning runs logged yet.");
      } else {
        const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
        const line = (row: string[]) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ");
        console.log([line(header), ...rows.map(line)].join("\n"));
        console.log("\nin = input tokens billed at or above full rate; cache = tokens read from cache; cost = estimate in USD from list prices.");
      }
      break;
    }
    case "refresh": {
      const targets = args[0] === "all" ? store.listRides() : [ride(args[0])];
      for (const target of targets) {
        await setGeoAnchor(target.home);
        const trip = await computeTrip({
          waypoints: target.waypoints,
          roundTrip: target.roundTrip,
          avoidMotorways: target.preferences.avoidMotorways,
        });
        if (trip.result.legs.length !== target.legs.length) {
          throw new Error(`Ride #${target.id} now routes into ${trip.result.legs.length} legs instead of ${target.legs.length}; not updated.`);
        }
        store.refreshRide(target.id, tripFigures(trip, routeCells(trip.shapes)));
        const fmt = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
        console.log(
          `Refreshed #${target.id} "${target.name}": ${target.distanceKm} km, ${fmt(target.ridingMinutes)} -> ${trip.result.totalDistanceKm} km, ${fmt(trip.result.totalRidingMinutes)}.` +
            (trip.complete ? "" : " Speed-limit data was unavailable, so the time is the router's pessimistic one; run refresh again later."),
        );
      }
      break;
    }
    case "delete": {
      const target = ride(args[0]);
      store.deleteRide(target.id);
      console.log(`Deleted #${target.id} "${target.name}".`);
      break;
    }
    case "clear-cache":
      console.log(`Removed ${store.cacheClear()} cached lookups.`);
      break;
    default:
      console.log(USAGE);
      process.exitCode = command && command !== "help" ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  store.close();
}
