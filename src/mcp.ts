import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRideServer } from "./rideServer.ts";
import { Store } from "./store.ts";

// The MCP server of the terminal's own client, over stdio: one rider, the library `Store` finds (ADR 0027).
const { server, context, runId, setHome, restoreHome } = createRideServer(new Store());

// The start point the rider saved wins; RIDE_HOME is what a person who has not chosen one gets.
if (!(await restoreHome()) && process.env.RIDE_HOME) {
  try {
    await setHome(process.env.RIDE_HOME);
  } catch (error) {
    process.stderr.write(`RIDE_HOME could not be resolved: ${error instanceof Error ? error.message : error}\n`);
  }
}
await server.connect(new StdioServerTransport());
process.stderr.write(`agentMotoride MCP server ready (start: ${context.home.label || "not set"}, run #${runId})\n`);
