// Drives the MCP server over stdio as a client would: tools, prompt, save, export. No model involved.
// Run with RIDE_DB pointing at a scratch file: RIDE_DB=/tmp/x.db npm run mcp:smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const env = { ...process.env, RIDE_DB: process.env.RIDE_DB!, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" };
delete (env as any).ANTHROPIC_API_KEY; delete (env as any).ANTHROPIC_AUTH_TOKEN;
const client = new Client({ name: "test", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/mcp.ts"], env, stderr: "pipe" }));
const call = async (name: string, args: any) => { const r: any = await client.callTool({ name, arguments: args }); const t = r.content[0].text; return r.isError ? `ERROR ${t}` : t; };
const tools = await client.listTools(); console.log("tools:", tools.tools.map((t) => t.name).join(", "));
console.log("prompts:", (await client.listPrompts()).prompts.map((p) => p.name).join(", "));
console.log("\n1 calculateTrip before home ->", (await call("calculateTrip", { waypoints: ["Lille", "Cassel"], roundTrip: true })).slice(0, 110));
console.log("\n2 rideSettings ->\n" + (await call("rideSettings", { home: "Lille", allowMotorways: false, max50Pct: 25 })));
const trip = JSON.parse(await call("calculateTrip", { waypoints: ["Lille", "Cassel", "Mont des Cats"], roundTrip: true }));
console.log("\n3 calculateTrip ->", trip.routeId, trip.totalDistanceKm, "km", trip.totalRidingTime, "open", trip.speedLimits.openRoadPct, "% | motorwaysPermitted", trip.motorwaysPermitted);
console.log("\n4 scoutAreas without key ->", (await call("scoutAreas", { areas: [{ name: "Flandre", location: "Cassel" }], rideDate: "2026-10-10", departure: "09:00", maxDistanceKm: null, maxRidingMinutes: null, constraints: "x" })).slice(0, 160));
console.log("\n5 saveRide ->", await call("saveRide", { routeId: trip.routeId, name: "Monts de Flandre", rideDate: "2026-10-10", departure: "09:00", itinerary: "Itinerary text...", request: "test" }));
console.log("6 saveRide bad routeId ->", (await call("saveRide", { routeId: "r99", name: "x", rideDate: null, departure: null, itinerary: "", request: "" })).slice(0, 90));
console.log("7 exportGpx ->", await call("exportGpx", { rideId: 1, file: process.env.RIDE_DB!.replace(".db", ".gpx") }));
console.log("8 listRides ->", await call("listRides", {}));
const prompt: any = await client.getPrompt({ name: "plan-ride", arguments: { request: "this Saturday, no rain" } });
const ptext = prompt.messages[0].content.text; console.log("\n9 prompt:", ptext.length, "chars | has system:", ptext.startsWith("You plan one-day"), "| has request:", ptext.includes("Rider's request: this Saturday"), "| has start:", ptext.includes("Start and end point: Lille"));
await client.close();
