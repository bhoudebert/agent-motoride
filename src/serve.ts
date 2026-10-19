// The MCP server over HTTP for several riders (ADR 0027): `npm run serve`. Put Caddy or another proxy in front for TLS.
import { Registry } from "./tenants.ts";
import { createHttpServer } from "./server.ts";

const host = process.env.RIDE_SERVER_HOST ?? "127.0.0.1";
const port = Number(process.env.RIDE_SERVER_PORT ?? 8788);
const registry = new Registry();
if (!registry.list().length) process.stderr.write("No riders yet: add one with `npm run admin -- add <email>`.\n");

const { http, sweep, close } = createHttpServer({ registry });
http.listen(port, host, () => process.stderr.write(`agentMotoride server listening on http://${host}:${port}/mcp\n`));
const timer = setInterval(() => void sweep(), 60_000);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void close().then(() => process.exit(0));
  });
}
