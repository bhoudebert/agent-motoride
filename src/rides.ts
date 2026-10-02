// Manage the saved-ride library without starting a planning session.
import { formatRideDetail, formatRideList, parseRating } from "./library.ts";
import { Store } from "./store.ts";

const USAGE = `Usage: npm run rides -- <command>

  list                                  All saved rides
  show <id|name>                        One ride: legs, map link, itinerary
  rate <id|name> <1-5> [note]           Rate a ride after riding it
  rate-leg <id|name> <leg> <1-5> [note] Rate one leg of a ride
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
