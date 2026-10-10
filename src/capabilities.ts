// Everything a rider can do, in one place: the MCP help prompt and tool, the
// terminal's `rides help`, and the guide's "Everything you can do" page are
// all rendered from this list, and a test fails when a tool, a prompt or a
// command is missing from it.

export type Moment =
  "Plan" | "Ride day" | "On the road" | "After the ride" | "Your library" | "Settings" | "Under the hood";

export interface Capability {
  moment: Moment;
  /** What it does, in a rider's words. */
  what: string;
  /** What to say in Claude Code or Codex. */
  say: string;
  /** Terminal commands: `npm run rides -- …`, `npm run ride -- …`, or `/…` at the refine> prompt. */
  terminal: string[];
  /** Claude Code slash command, without the /mcp__ride__ prefix. */
  slash?: string;
  /** MCP tools behind it. */
  tools: string[];
}

export const MOMENTS: Moment[] = [
  "Plan",
  "Ride day",
  "On the road",
  "After the ride",
  "Your library",
  "Settings",
  "Under the hood",
];

export const CAPABILITIES: Capability[] = [
  // Plan
  {
    moment: "Plan",
    what: "Plan a new ride from one sentence: scouts explore two to four areas, the best loop comes back checked",
    say: "a twisty loop on Saturday, no rain, under 200 km, leaving at 9",
    terminal: ['npm run ride -- "<request>"', "npm run ride (menu)"],
    slash: "plan-ride <request>",
    tools: [
      "planningGuide",
      "listSavedRides",
      "recallArea",
      "scoutAreas",
      "reportScout",
      "searchRoads",
      "calculateTrip",
      "getWeather",
      "getDaylight",
      "checkConditions",
      "getSpeedCameras",
      "findStops",
      "planStops",
      "getTraffic",
      "checkItinerary",
    ],
  },
  {
    moment: "Plan",
    what: "Ride a saved roadbook again on a day: that day's forecast, open stops and a go or no-go, no copy",
    say: "plan a ride from roadbook 7 on Saturday at 9",
    terminal: ["npm run rides -- plan <roadbook> <day> [time]", "/plan <day> [time]"],
    slash: "plan-from <roadbook> <day> [time]",
    tools: ["planRide"],
  },
  {
    moment: "Plan",
    what: "A practical trip: point to point, motorways allowed, traffic checked",
    say: "I need to be in Brussels by 9 on Monday",
    terminal: ['npm run ride -- --allow-motorways "<trip>"'],
    slash: "commute <destination> <when> [from]",
    tools: ["getTraffic"],
  },
  {
    moment: "Plan",
    what: "Change a roadbook in words: changed in place, the previous version kept, rides already ridden untouched",
    say: "make roadbook 7 50 km longer, lunch in Die",
    terminal: ['npm run ride -- --roadbook <id> "<change>"'],
    slash: "edit-ride <id|name> <change>",
    tools: ["planningGuide"],
  },
  {
    moment: "Plan",
    what: "Import a route someone shared (GPX or KML): routed and measured like your own",
    say: "import ~/Downloads/route.gpx",
    terminal: ["npm run rides -- import <file.gpx|kml> [name]"],
    tools: ["importRoute"],
  },
  {
    moment: "Plan",
    what: "Plan from a photo of a map, a route screenshot or a list of places",
    say: "(attach the picture) plan this loop",
    terminal: ["npm run ride -- --image <file>", "/image <file>"],
    tools: ["calculateTrip"],
  },
  {
    moment: "Plan",
    what: "Save the itinerary on the table as a roadbook",
    say: "save it as Monts de Flandre",
    terminal: ["/save [name]", "/save --copy [name]"],
    slash: "save-ride [name]",
    tools: ["saveRide"],
  },
  // Ride day
  {
    moment: "Ride day",
    what: "Morning briefing: fresh forecast, daylight, traffic, stops open at arrival, go or no-go",
    say: "briefing for Saturday's ride of roadbook 7",
    terminal: ["npm run rides -- today [roadbook] [day]"],
    slash: "today [id|name]",
    tools: ["rideBriefing"],
  },
  {
    moment: "Ride day",
    what: "The whole ride on one map: the loop, towns, stops and every fixed camera with its limit",
    say: "show me roadbook 7 on a map",
    terminal: ["npm run rides -- map <roadbook>", "/map"],
    tools: ["showRideMap"],
  },
  {
    moment: "Ride day",
    what: "For the GPS and the phone: GPX, navigation links, a QR code, a page on your Wi-Fi",
    say: "export roadbook 7 as GPX",
    terminal: [
      "npm run rides -- export <roadbook>",
      "npm run rides -- qr <roadbook>",
      "npm run rides -- share <roadbook>",
      "/gpx",
      "/qr",
      "/share",
    ],
    slash: "export-gpx [id|name]",
    tools: ["exportGpx"],
  },
  {
    moment: "Ride day",
    what: "A Markdown document of the ride, with its map, for your notes",
    say: "export roadbook 7 as Markdown",
    terminal: ["npm run rides -- export-md <roadbook>", "/md"],
    slash: "export-md <id|name> [file]",
    tools: ["exportMarkdown"],
  },
  // On the road
  {
    moment: "On the road",
    what: "A note about the last minutes, said at a stop: placed on the road after the ride",
    say: "last 10 minutes awesome",
    terminal: ['npm run rides -- note "<text>" [--rating 0-5]', "/note <text>"],
    slash: "note <text>",
    tools: ["addRideNote"],
  },
  // After the ride
  {
    moment: "After the ride",
    what: "Review with your recorded track: notes placed on the road you rode, detours, pace, ratings to confirm",
    say: "review my ride with ~/Downloads/track.gpx",
    terminal: ["npm run rides -- review [roadbook] [track.gpx]", "npm run rides -- notes"],
    slash: "review [gpxPath] [ride]",
    tools: ["reviewRide"],
  },
  {
    moment: "After the ride",
    what: "Rate a roadbook or one of its legs: 4-5 sought out by later plans, 0-1 avoided",
    say: "rate roadbook 7 five, superb; leg 2: never again, gravel",
    terminal: [
      "npm run rides -- rate <roadbook> <0-5> [note]",
      "npm run rides -- rate-leg <roadbook> <leg> <0-5> [note]",
      "/rate",
    ],
    slash: "rate <roadbook> <0-5> [note]",
    tools: ["rateRide"],
  },
  {
    moment: "After the ride",
    what: "Rate how the day went (weather, traffic, company), apart from the roads",
    say: "Saturday on roadbook 7 was cold, 2 out of 5",
    terminal: ["npm run rides -- rate-day <roadbook> <day> <0-5> [note]"],
    tools: ["rateRide"],
  },
  {
    moment: "After the ride",
    what: "Rate a stretch of road you rode, outside any roadbook",
    say: "the stretch from Rue de Longuesault 1, Tournai to Hollain was very nice, 5",
    terminal: ['npm run rides -- rate-stretch "<from>" "<to>" <0-5> [note]'],
    slash: "rate-stretch <from> <to> <0-5> [note]",
    tools: ["rateStretch"],
  },
  {
    moment: "After the ride",
    what: "See every rating that steers your plans, and remove a stretch rating",
    say: "which roads have I rated?",
    terminal: ["npm run rides -- rated", "npm run rides -- unrate-stretch <id>"],
    tools: ["listRatedRoads", "deleteStretchRating"],
  },
  // Your library
  {
    moment: "Your library",
    what: "Your roadbooks (saved loops) and your rides (a roadbook on a day), 20 per page",
    say: "list my roadbooks; my latest rides",
    terminal: ["npm run rides -- roadbooks [--page N]", "npm run rides -- rides [--page N]", "/roadbooks", "/rides"],
    slash: "list-roadbooks [page]",
    tools: ["listRoadbooks", "listRides"],
  },
  {
    moment: "Your library",
    what: "Everything about a roadbook (versions, rides), or one ride with the route it rode",
    say: "show roadbook 7; show Saturday's ride of roadbook 7",
    terminal: ["npm run rides -- show <roadbook> [day]", "/show"],
    slash: "show-ride <id|name>",
    tools: ["showRide"],
  },
  {
    moment: "Your library",
    what: "Versions of a roadbook: bring one back, copy it as a variant, keep a planned ride on the previous one",
    say: "undo that change on roadbook 7; copy roadbook 7 as Short Flandre",
    terminal: [
      "npm run rides -- versions <roadbook>",
      "npm run rides -- restore <roadbook> <version>",
      "npm run rides -- copy <roadbook> [name]",
      "npm run rides -- keep <roadbook> <day>",
    ],
    tools: ["restoreRoadbook", "copyRoadbook", "keepRideVersion"],
  },
  {
    moment: "Your library",
    what: "Recompute a roadbook with today's map data, or only its stop plan",
    say: "refresh roadbook 7",
    terminal: ["npm run rides -- refresh <roadbook|all> [--stops]"],
    slash: "refresh <id|name>",
    tools: ["refreshRide"],
  },
  {
    moment: "Your library",
    what: "Cancel a planned ride, delete a ride or a roadbook (asked first; road ratings stay), tidy the file",
    say: "I'm not riding Saturday; delete roadbook 7",
    terminal: [
      "npm run rides -- cancel <roadbook> <day>",
      "npm run rides -- delete roadbook <roadbook>",
      "npm run rides -- delete ride <roadbook> <day>",
      "npm run rides -- tidy",
      "npm run rides -- clear-cache",
    ],
    tools: ["cancelRide", "deleteRide", "deleteRoadbook"],
  },
  // Settings
  {
    moment: "Settings",
    what: "Start point, motorways, slow-zone targets, the fast-expressway ceiling, repeats",
    say: "allow motorways; aim for 10% in 50 zones; allow up to 40% of fast expressways",
    terminal: [
      "npm run ride -- --from <place> --allow-motorways --max-fast-pct <n>",
      "/motorways on|off",
      "/fast <n>",
      "/settings",
    ],
    tools: ["rideSettings"],
  },
  {
    moment: "Settings",
    what: "Your bike: tank range, reserve, pause interval, lunch",
    say: "my bike does 300 km on a tank, pause every hour and a half",
    terminal: ["npm run rides -- bike [range=… reserve=… pause=… stint=… lunch=…]", "/bike"],
    tools: ["rideSettings"],
  },
  // Under the hood
  {
    moment: "Under the hood",
    what: "What each session did and cost, step by step, and its export to an observability tool",
    say: "(terminal) npm run rides -- runs",
    terminal: [
      "npm run rides -- runs [--csv]",
      "npm run rides -- trace <run> [--full]",
      "npm run rides -- otel <run>",
      "/usage",
      "/trace",
    ],
    tools: [],
  },
  {
    moment: "Under the hood",
    what: "This list",
    say: "what can you do?",
    terminal: ["npm run rides -- help", "/help", "/back", "/quit"],
    slash: "help",
    tools: ["capabilities"],
  },
];

/** The list for a rider in an MCP client: what to say, and the slash command when there is one. */
export function formatForClients(): string {
  const lines = [
    "Everything agentMotoride does. Say it in plain words; slash commands are shortcuts in Claude Code.",
    "",
  ];
  for (const moment of MOMENTS) {
    lines.push(moment.toUpperCase());
    for (const c of CAPABILITIES.filter((x) => x.moment === moment)) {
      lines.push(`- ${c.what}`, `    say: "${c.say}"${c.slash ? `   or /mcp__ride__${c.slash}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** The list for the terminal: what each command is for, by moment. */
export function formatForTerminal(): string {
  const lines = [
    "Everything agentMotoride does, from the terminal. Full options: npm run rides -- --help, npm run ride -- --help",
    "",
  ];
  for (const moment of MOMENTS) {
    lines.push(moment.toUpperCase());
    for (const c of CAPABILITIES.filter((x) => x.moment === moment)) {
      lines.push(`- ${c.what}`, ...c.terminal.map((t) => `    ${t}`));
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
