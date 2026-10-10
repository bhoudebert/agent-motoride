// Manage the saved-ride library without starting a planning session.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { rideBriefing } from "./briefing.ts";
import { formatForTerminal } from "./capabilities.ts";
import {
  addRideNote,
  applyReview,
  clockAt,
  formatReview,
  type ReviewDecision,
  readTrack,
  reviewRide,
  rideToReview,
} from "./feedback.ts";
import { routeCells } from "./geometry.ts";
import { describeStopsAt, exportSavedRide, savedRideGpx } from "./gpx.ts";
import {
  DuplicateRideError,
  enrichRide,
  copyRoadbook,
  followingRides,
  formatRatedRoads,
  formatRideDetail,
  formatVersions,
  rateStretch,
  restoreVersion,
  formatRideDayPage,
  formatRoadbookPage,
  parseRating,
  replanStops,
  rideNavigation,
  saveCurrentRide,
  tripFigures,
} from "./library.ts";
import { startPoint } from "./start.ts";
import { formatRideMarkdown, writeRideMarkdown } from "./markdown.ts";
import { rideMapPng, writeRideMap } from "./rideMap.ts";
import { describeProfile, parseProfileArgs } from "./profile.ts";
import { printQr, startShareServer } from "./share.ts";
import { formatStopPlan } from "./stops.ts";
import { Store } from "./store.ts";
import { setGeoAnchor } from "./tools/geo.ts";
import { computeTrip } from "./tools/trip.ts";
import { otlpEndpoint, otlpHeaders, runToOtlp, sendOtlp } from "./otel.ts";
import { preferencesFromEnv } from "./preferences.ts";
import { importRoute, readRouteFile } from "./routeImport.ts";
import { type RideContext, registerRoute } from "./session.ts";
import {
  deleteRideQuestion,
  deleteRoadbookQuestion,
  rideOnDay,
  rideToBrief,
  roadbookOf,
  tidyLibrary,
} from "./housekeeping.ts";
import { localDay, parsePlanRide, planRideFrom } from "./planRide.ts";
import { formatTrace } from "./trace.ts";
import { emptyUsage } from "./usage.ts";

const USAGE = `Usage: npm run rides -- <command>

  help                                  Everything the app does, by moment, with the command for each

  roadbooks [--page N]                  Roadbooks (the loops and trips you saved), newest first, 20 per page
  rides [--page N]                      Rides (a roadbook on a day), latest date first, 20 per page
  plan <roadbook> <day> [time]          Plan a ride from a roadbook: day as 2026-10-17, 17/10, saturday, tomorrow;
                                        time as 9, 9:30, 9h30 (default the roadbook's last departure). No copy, no model
  today [roadbook] [day]                Ride-day briefing: weather now, daylight, traffic, stops checked against opening hours, go or no-go
                                        (default the next planned ride; with a day, that ride of the roadbook)
  show <id|name> [day] [--md]           One roadbook, or one of its rides with the route it was ridden on (--md: Markdown)
  keep <roadbook> <day>                 Keep a planned ride on the version it had before the last change
  export-md <id|name> [file.md]         Write the ride as a Markdown document, with its map (default: exports/ in the project)
  map <id|name> [file.png]              A picture of the ride: route, towns, stops, fixed cameras with their limits
  rate <id|name> <0-5> [note]           Rate a roadbook: its roads, for later plans (0 never again, 5 loved)
  rate-day <roadbook> <day> <0-5> [note]  Rate how a ride went that day (weather, traffic, company); never a road rating
  rate-stretch "<from>" "<to>" <0-5> [note] [--via "<place>"]
                                        Rate a stretch of road you rode, outside any roadbook: routed, stored as a
                                        road rating, no roadbook added. Prints the map link to check it
  rated                                 Every rating that steers planning: roadbooks, legs, stretches (with their id)
  unrate-stretch <id> [--yes]           Remove a stretch rating, after you confirm
  rate-leg <id|name> <leg> <1-5> [note] Rate one leg of a ride
  note "<text>" [--rating 0-5] [--back N] [--roadbook id|name]
                                        During the ride: a note about the last N minutes (default 10), on today's ride
  notes [--all]                         Notes waiting for review (--all: reviewed and dismissed ones too)
  review [id|name] [track.gpx] [--yes]  After the ride: place the notes on the recorded track (or on the plan without one),
                                        show detours and pace, then confirm a rating per road stretch (--yes: accept all proposals)
  export <id|name> [file.gpx] [--pins N]  Write the ride as a GPX file (default: exports/ in the project); --pins caps the route points
  qr <id|name>                          QR code of the ride's Google Maps link
  share <id|name>                       Serve the ride to the phone on the local Wi-Fi (QR code), until Ctrl-C
  trace <run> [--full]                  Replay a planning session step by step (run ids from "runs")
  otel <run|last> [--content] [--file out.json]
                                        Export a session as OpenTelemetry traces to OTEL_EXPORTER_OTLP_ENDPOINT, else to a file;
                                        --content adds prompts, answers and tool data (they hold your places and routes)
  bike [range=250 reserve=40 pause=75 stint=90 lunch=yes]   Show or set the bike profile used to plan stops
  runs [--csv]                          Every planning session with model, effort, tokens, cost and result
  refresh <id|name|all> [--stops]       Route a saved ride again: distance, times, road mix, leg names, daylight, cameras, stops
                                        --stops: only rebuild the stop plan from the bike profile (instant when the stops are cached)
  import <file.gpx|file.kml> [name] [--force]
                                        Save a route someone shared: routed like a planned ride (figures, stops, cameras),
                                        with waypoints added until it follows the file; --force saves a duplicate anyway
  delete roadbook <id|name> [--yes]     Delete a roadbook with its rides and notes, after you confirm (road ratings stay)
  delete ride <roadbook> <day> [--yes]  Delete one ride of a roadbook, e.g. delete ride 7 2026-10-10, after you confirm
  cancel <roadbook> <day>               Cancel a planned ride: kept, shown as cancelled
  versions <roadbook>                   Earlier versions of a roadbook: each change keeps the design it replaced
  restore <roadbook> <version>          Bring back an earlier version; the current one is kept as a version too
  copy <roadbook> [name]                A separate roadbook with the same design, to change on its own
  tidy                                  Drop expired lookups and compact the library; lists backups and old files, deletes none
  clear-cache                           Drop cached road, route and weather lookups

Ratings steer later planning: legs, rides and road stretches rated 4-5 are
reused as building blocks, those rated 0-1 are avoided.`;

const [command, ...args] = process.argv.slice(2);
const store = new Store();

function ride(idOrName: string | undefined) {
  if (!idOrName) throw new Error("Which ride? Give its id or name.");
  const found = store.findRide(idOrName);
  if (!found) throw new Error(`No saved ride matches "${idOrName}". Run: npm run rides -- roadbooks`);
  return found;
}

/** Ask before deleting; --yes answers for scripts. Without a terminal and without --yes, nothing is deleted. */
async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error(`${question}\nNot deleted: add --yes to confirm without a terminal.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  if (/^y(es)?$/i.test(answer.trim())) return true;
  console.log("Not deleted.");
  return false;
}

/** --page N, or 1. */
function pageArg(args: string[]): number {
  const at = args.indexOf("--page");
  if (at === -1) return 1;
  const page = Number(args[at + 1]);
  if (!Number.isInteger(page) || page < 1) throw new Error("--page takes a page number: 1, 2, ...");
  return page;
}

try {
  switch (command) {
    case "help":
      console.log(formatForTerminal());
      break;
    case "roadbooks":
      console.log(
        formatRoadbookPage(store.listRoadbooks(pageArg(args)), (n) => `npm run rides -- roadbooks --page ${n}`),
      );
      break;
    case "list":
      // Kept only to point to the two lists it became.
      console.log(
        "Two lists now: npm run rides -- roadbooks (saved loops and trips), npm run rides -- rides (by date).",
      );
      break;
    case "plan": {
      const [roadbook, ...when] = args;
      const words = when.join(" ");
      const parsed = roadbook ? parsePlanRide(`plan roadbook ${roadbook} ${words}`) : null;
      if (!roadbook || !parsed) {
        throw new Error("Usage: npm run rides -- plan <roadbook> <day> [time], e.g. plan 7 saturday 9:30");
      }
      console.log(await planRideFrom(store, roadbook, parsed.date, parsed.departure));
      break;
    }
    case "rides":
      console.log(formatRideDayPage(store.listRideDays(pageArg(args)), (n) => `npm run rides -- rides --page ${n}`));
      break;
    case "today": {
      const today = localDay(new Date());
      const target = rideToBrief(store, today, args[0], args.slice(1).join(" ") || undefined);
      console.log(await rideBriefing(store, target, today));
      break;
    }
    case "rate-stretch": {
      const via: string[] = [];
      const rest: string[] = [];
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--via" && args[i + 1]) via.push(args[++i]!);
        else rest.push(args[i]!);
      }
      const [from, to] = args;
      if (!from || !to)
        throw new Error('Usage: npm run rides -- rate-stretch "<from>" "<to>" <0-5> [note] [--via "<place>"]');
      const { rating, notes } = parseRating(rest);
      await setGeoAnchor(from);
      console.log((await rateStretch(store, { from, to, via, rating, reason: notes })).text);
      break;
    }
    case "rated":
      console.log(formatRatedRoads(store));
      break;
    case "unrate-stretch": {
      const id = Number(args[0]);
      const stretch = store.listRoadRatings().find((r) => r.id === id);
      if (!stretch) throw new Error(`No stretch rating #${args[0] ?? ""}. List them with: npm run rides -- rated`);
      if (!(await confirm(`Remove the rating ${stretch.rating}/5 of ${stretch.road}?`, args.includes("--yes")))) break;
      store.deleteRoadRating(id);
      console.log(`Removed stretch rating #${id}.`);
      break;
    }
    case "rate-day": {
      const found = rideOnDay(store, args[0] ?? "", args[1] ?? "");
      const { rating, notes } = parseRating(args.slice(2));
      store.rateRideDay(found.ride.id, rating, notes);
      console.log(
        `Rated the ride of ${found.date} on roadbook #${found.saved.id} ${rating}/5; the roads keep their own rating.`,
      );
      break;
    }
    case "show": {
      // "show 7 saturday": that ride, with the route it was planned or ridden on.
      const day = args
        .slice(1)
        .filter((a) => a !== "--md")
        .join(" ");
      const found = day ? rideOnDay(store, args[0] ?? "", day) : undefined;
      const target = found ? store.rideView(found.saved.id, found.ride.id)! : ride(args[0]);
      console.log(args.includes("--md") ? formatRideMarkdown(target) : formatRideDetail(target, store));
      break;
    }
    case "keep": {
      const found = rideOnDay(store, args[0] ?? "", args.slice(1).join(" "));
      const version = store.keepPreviousVersion(found.ride.id);
      console.log(`The ride of ${found.date} keeps roadbook #${found.saved.id} as it was (version ${version}).`);
      break;
    }
    case "export-md": {
      const target = ride(args[0]);
      console.log(`Markdown written: ${writeRideMarkdown(target, args[1])}`);
      break;
    }
    case "map": {
      const target = ride(args[0]);
      console.log(`Map written: ${writeRideMap(target, args[1])}`);
      break;
    }
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
        throw new Error(`Roadbook #${target.id} has no leg ${args[1] ?? ""}; it has legs 1 to ${target.legs.length}.`);
      }
      console.log(`Rated leg ${seq} of #${target.id} "${target.name}" ${rating}/5.`);
      break;
    }
    case "note": {
      const flag = (name: string) => {
        const at = args.indexOf(name);
        return at >= 0 ? args.splice(at, 2)[1] : undefined;
      };
      const rating = flag("--rating");
      const back = flag("--back");
      const rideName = flag("--roadbook") ?? flag("--ride");
      const text = args.join(" ").trim();
      if (!text) throw new Error('What about it? e.g. npm run rides -- note "last 10 min awesome" --rating 5');
      const { note, ride: target } = addRideNote(store, {
        ride: rideName,
        text,
        rating: rating === undefined ? null : Number(rating),
        minutesBack: back === undefined ? undefined : Number(back),
      });
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const end = Date.parse(note.createdAt);
      console.log(
        `Noted on #${target.id} "${target.name}": ${clockAt(end - note.minutesBack * 60_000, timezone)}-${clockAt(end, timezone)} "${note.text}". Review it after the ride: npm run rides -- review`,
      );
      break;
    }
    case "notes": {
      const notes = store.listNotes({ all: args.includes("--all") });
      if (!notes.length) console.log("No notes waiting for review.");
      for (const note of notes) {
        console.log(
          `#${note.id}  roadbook #${note.rideId}  ${note.createdAt.slice(0, 16).replace("T", " ")} UTC  last ${note.minutesBack} min  ${note.rating ?? "-"}  ${note.status}  "${note.text}"`,
        );
      }
      break;
    }
    case "review": {
      const trackFile = args.find((a) => a.toLowerCase().endsWith(".gpx"));
      const rideName = args.find((a) => a !== trackFile && !a.startsWith("--"));
      const target = rideToReview(store, rideName);
      const review = await reviewRide(store, target, {
        track: trackFile ? readTrack(trackFile) : undefined,
        trackPath: trackFile ? resolve(trackFile) : undefined,
      });
      console.log(formatReview(review));
      const placed = review.notes.filter((n) => n.placement);
      if (!placed.length) break;
      let decisions: ReviewDecision[];
      if (args.includes("--yes")) decisions = placed.map((n) => ({ noteId: n.note.id }));
      else if (!process.stdin.isTTY) {
        console.log("\nRun again in a terminal to confirm each rating, or with --yes to accept the proposals.");
        break;
      } else {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        decisions = [];
        console.log("\nRating per note: Enter keeps the proposal, 0-5 sets it, s skips for now, d dismisses the note.");
        for (const { note, placement } of placed) {
          const proposal = placement!.proposedRating;
          const answer = (await rl.question(`#${note.id} "${note.text}" [${proposal ?? "?"}]: `)).trim().toLowerCase();
          if (answer === "s" || (answer === "" && proposal === null)) continue;
          if (answer === "d") decisions.push({ noteId: note.id, dismiss: true });
          else decisions.push({ noteId: note.id, rating: answer === "" ? undefined : Number(answer) });
        }
        rl.close();
      }
      for (const line of applyReview(store, decisions)) console.log(line);
      break;
    }
    case "export": {
      const target = ride(args[0]);
      const pinsAt = args.indexOf("--pins");
      const maxPoints = pinsAt >= 0 ? Number(args[pinsAt + 1]) : undefined;
      const file = args.slice(1).find((a, i) => !a.startsWith("--") && args[i] !== "--pins");
      const { path, rerouted, stopsAt } = await exportSavedRide(store, target, file, maxPoints);
      console.log(
        `GPX written: ${path}${rerouted ? "\n(Route line was not stored for this ride; it was routed again from its waypoints.)" : ""}`,
      );
      if (stopsAt.length)
        console.log(
          `Planned stops in the route point list (as an app numbers the stages):\n${describeStopsAt(stopsAt).join("\n")}`,
        );
      break;
    }
    case "trace": {
      const id = Number(args[0]);
      const run = Number.isInteger(id) ? store.findRun(id) : undefined;
      if (!run) throw new Error(`Which run? Give a run id from: npm run rides -- runs`);
      console.log(formatTrace(run, store.listTrace(run.id), args.includes("--full")));
      break;
    }
    case "otel": {
      const runs = store.listRuns();
      const run = args[0] === "last" ? runs.at(-1) : store.findRun(Number(args[0]));
      if (!run) throw new Error("Which run? Give a run id from: npm run rides -- runs, or last");
      const traces = runToOtlp(run, store.listTrace(run.id), { content: args.includes("--content") });
      const spans = traces.resourceSpans[0]!.scopeSpans[0]!.spans.length;
      const fileAt = args.indexOf("--file");
      const endpoint = otlpEndpoint();
      if (fileAt < 0 && endpoint) {
        await sendOtlp(traces, endpoint, otlpHeaders());
        console.log(`Run #${run.id}: ${spans} spans sent to ${endpoint}.`);
      } else {
        const file = resolve(args[fileAt + 1] && fileAt >= 0 ? args[fileAt + 1]! : `exports/run-${run.id}.otlp.json`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(traces, null, 1));
        console.log(
          `Run #${run.id}: ${spans} spans written to ${file}. Set OTEL_EXPORTER_OTLP_ENDPOINT to send them instead.`,
        );
      }
      break;
    }
    case "qr": {
      const target = ride(args[0]);
      console.log(`${target.name}\n${target.mapsUrl}`);
      await printQr(target.mapsUrl);
      break;
    }
    case "share": {
      const target = ride(args[0]);
      const { gpx } = await savedRideGpx(store, target);
      const nav = rideNavigation(target);
      const shared = {
        picture: target.shapes?.length ? rideMapPng(target) : undefined,
        name: target.name,
        mapsUrl: nav.links[0]!,
        mapsUrls: nav.links,
        overviewUrl: nav.overview,
        itinerary: target.itinerary,
        gpx,
      };
      const { url } = await startShareServer(() => shared, Number(process.env.RIDE_SHARE_PORT) || 8787);
      console.log(`Scan with the phone (same Wi-Fi): ${url}\nServing until Ctrl-C.`);
      await printQr(url);
      await new Promise(() => undefined); // until Ctrl-C
      break;
    }
    case "bike": {
      const profile = args.length ? store.setProfile(parseProfileArgs(args)) : store.getProfile();
      console.log(`Bike profile: ${describeProfile(profile)}`);
      if (args.length) console.log("Stop plans of saved rides update on their next refresh.");
      break;
    }
    case "runs": {
      const runs = store.listRuns();
      const csv = args.includes("--csv");
      const header = [
        "run",
        "date",
        "model",
        "effort",
        "turns",
        "calls",
        "tools",
        "in",
        "cache",
        "out",
        "secs",
        "cost",
        "km",
        "ride_min",
        "open%",
        "70+t%",
        "50%",
        "30%",
        "ride",
        "status",
        "request",
      ];
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
          run.result?.time70Pct ?? "-",
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
        const line = (row: string[]) =>
          row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ");
        console.log([line(header), ...rows.map(line)].join("\n"));
        console.log(
          "\nin = input tokens billed at or above full rate; cache = tokens read from cache; cost = estimate in USD from list prices; 70+t% = share of riding time on roads limited to 70 or more.\nmcp-client rows: tokens and cost are the scouts' only (the client's model is not visible); km and shares are from the saved ride, else the last routed trip.",
        );
      }
      break;
    }
    case "refresh": {
      const targets = args[0] === "all" ? store.listRides() : [ride(args[0])];
      if (args.includes("--stops")) {
        for (const target of targets) {
          const extras = await replanStops(store, target);
          if (!extras?.stopPlan) {
            console.log(`#${target.id} "${target.name}": no route line stored; run a full refresh first.`);
            continue;
          }
          console.log(`#${target.id} "${target.name}"`);
          console.log(formatStopPlan(extras.stopPlan, target.departure ?? "09:00", target.ridingMinutes).join("\n"));
        }
        break;
      }
      for (const target of targets) {
        await setGeoAnchor(startPoint(target));
        const trip = await computeTrip({
          waypoints: target.waypoints,
          roundTrip: target.roundTrip,
          avoidMotorways: target.preferences.avoidMotorways,
        });
        if (trip.result.legs.length !== target.legs.length) {
          throw new Error(
            `Roadbook #${target.id} now routes into ${trip.result.legs.length} legs instead of ${target.legs.length}; not updated.`,
          );
        }
        store.refreshRide(target.id, tripFigures(trip, routeCells(trip.shapes)));
        const extras = await enrichRide(store, store.findRide(String(target.id))!);
        for (const [name, reason] of Object.entries(extras?.errors ?? {}))
          console.error(`  ${name}: ${reason.split(".")[0]}`);
        const fmt = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
        console.log(
          `Refreshed #${target.id} "${target.name}": ${target.distanceKm} km, ${fmt(target.ridingMinutes)} -> ${trip.result.totalDistanceKm} km, ${fmt(trip.result.totalRidingMinutes)}.` +
            (trip.complete
              ? ""
              : " Speed-limit data was unavailable, so the time is the router's pessimistic one; run refresh again later."),
        );
      }
      break;
    }
    case "import": {
      const path = args.find((a) => /\.(gpx|kml)$/i.test(a));
      if (!path) throw new Error("Which file? e.g. npm run rides -- import ~/Downloads/route.gpx");
      const file = readRouteFile(path);
      const preferences = preferencesFromEnv();
      const start = file.points[0]!;
      const runId = store.startRun({
        home: `${start.lat},${start.lon}`,
        request: `import ${path}`,
        usage: emptyUsage("none", "n/a"),
        costUsd: 0,
        result: null,
        rideId: null,
        error: null,
      });
      const context: RideContext = {
        store,
        preferences,
        home: { ...start, label: `${start.lat},${start.lon}` },
        allowRepeat: false,
        lineage: new Set(),
        routes: new Map(),
        runId,
        usage: emptyUsage("none", "n/a"),
        trace: (event) => store.addTrace(runId, event),
        stopPlans: new Map(),
      };
      await setGeoAnchor(`${start.lat},${start.lon}`);
      const imported = await importRoute(file, { avoidMotorways: preferences.avoidMotorways, route: computeTrip });
      const route = registerRoute(context, imported.trip);
      const trip = imported.trip.result;
      const name =
        args.filter((a) => a !== path && !a.startsWith("--")).join(" ") ||
        file.name ||
        `Imported ${trip.legs[0]?.from ?? "route"} loop`;
      const summary = [
        `${name}: imported from ${path.split("/").at(-1)}, ${file.lengthKm} km in the file.`,
        `Routed ${trip.totalDistanceKm} km, ${trip.totalRidingTime} riding, ${imported.fidelityPct}% of the file's line followed (${imported.passes} routing pass${imported.passes > 1 ? "es" : ""}, ${imported.waypoints.length} waypoints).`,
        ...trip.legs.map((leg, i) => `${i + 1}. ${leg.from} -> ${leg.to}: ${leg.distanceKm} km, ${leg.ridingTime}`),
      ].join("\n");
      console.log(summary);
      if (imported.fidelityPct < 90) {
        const why = preferences.avoidMotorways
          ? " Motorways are forbidden, so any motorway in the file was routed around."
          : "";
        console.log(
          `Below 90%: legs ${imported.weakLegs.map((l) => `${l.leg} (${l.coveragePct}%)`).join(", ")} leave the file's roads.${why}`,
        );
      }
      let id: number;
      try {
        id = saveCurrentRide(
          context,
          { route, rideDate: null, departure: null, title: name, itinerary: summary },
          { request: `import ${path}`, parentId: null, home: context.home.label, force: args.includes("--force") },
        );
      } catch (error) {
        if (error instanceof DuplicateRideError) {
          throw new Error(`${error.message} Add --force to save it anyway.`, { cause: error });
        }
        throw error;
      }
      await enrichRide(store, store.findRide(String(id))!);
      console.log(`Saved as #${id}. See it with: npm run rides -- show ${id}`);
      break;
    }
    case "delete": {
      const yes = args.includes("--yes");
      const words = args.filter((a) => a !== "--yes");
      if (words[0] === "ride") {
        const found = rideOnDay(store, words[1] ?? "", words.slice(2).join(" "));
        if (!(await confirm(deleteRideQuestion(found), yes))) break;
        store.deleteRideDay(found.ride.id);
        console.log(`Deleted the ride of ${found.date} from roadbook #${found.saved.id}.`);
        break;
      }
      // "delete roadbook 7", or "delete 7" as before.
      const target = roadbookOf(store, (words[0] === "roadbook" ? words.slice(1) : words).join(" "));
      if (!(await confirm(deleteRoadbookQuestion(store, target), yes))) break;
      store.deleteRide(target.id);
      console.log(`Deleted roadbook #${target.id} "${target.name}".`);
      break;
    }
    case "cancel": {
      const found = rideOnDay(store, args[0] ?? "", args.slice(1).join(" "));
      store.cancelRide(found.ride.id);
      console.log(
        `Cancelled the ride of ${found.date} from roadbook #${found.saved.id} "${found.saved.name}"; it stays in the list.`,
      );
      break;
    }
    case "versions": {
      const target = ride(args[0]);
      const lines = formatVersions(store, target);
      console.log(lines.length ? lines.join("\n") : `Roadbook #${target.id} "${target.name}" was never changed.`);
      break;
    }
    case "restore": {
      const target = ride(args[0]);
      const version = Number(args[1]);
      if (!Number.isInteger(version)) throw new Error("Usage: npm run rides -- restore <roadbook> <version>");
      const now = restoreVersion(store, target.id, version);
      console.log(
        `Roadbook #${target.id} is back to version ${version}, saved as version ${now}; the one it replaced is kept.`,
      );
      const following = followingRides(store, target.id);
      if (following) console.log(following);
      break;
    }
    case "copy": {
      const target = ride(args[0]);
      const id = copyRoadbook(store, target.id, args.slice(1).join(" "));
      console.log(`Copied roadbook #${target.id} as #${id} "${store.findRide(String(id))!.name}".`);
      break;
    }
    case "tidy":
      console.log(tidyLibrary(store));
      break;
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
