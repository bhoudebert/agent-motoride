// The MCP server over HTTP for several riders (ADR 0027): `npm run serve`. Put Caddy or another proxy in front for TLS.
import { Registry } from "./tenants.ts";
import { createAdminServer, MIN_ADMIN_TOKEN } from "./adminApi.ts";
import { createHttpServer } from "./server.ts";

const host = process.env.RIDE_SERVER_HOST ?? "127.0.0.1";
const port = Number(process.env.RIDE_SERVER_PORT ?? 8788);
const registry = new Registry();
if (!registry.list().length) process.stderr.write("No riders yet: add one with `npm run admin -- add <email>`.\n");

// Sign-in for ChatGPT and Claude (ADR 0056): off unless asked for, and it needs the address the server has on the internet.
const publicUrl = process.env.RIDE_SERVER_URL;
const oauthOn = /^(1|on|true|yes)$/i.test(process.env.RIDE_OAUTH ?? "");
if (oauthOn && !publicUrl)
  process.stderr.write("RIDE_OAUTH is on but RIDE_SERVER_URL is not set: sign-in for chat assistants is off.\n");
const secureUrl = publicUrl !== undefined && /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(publicUrl);
if (oauthOn && publicUrl && !secureUrl)
  process.stderr.write(
    "RIDE_OAUTH needs RIDE_SERVER_URL to be an https:// address: sign-in for chat assistants is off.\n",
  );
const oauth =
  oauthOn && publicUrl && secureUrl
    ? {
        baseUrl: publicUrl,
        redirects: (process.env.RIDE_OAUTH_REDIRECTS ?? "")
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean),
      }
    : undefined;

const { http, sweep, close } = createHttpServer({ registry, oauth });

// The provisioning API of a hosted service (ADR 0057): off unless asked for, on a port of its own that no public proxy passes.
let admin: ReturnType<typeof createAdminServer> | null = null;
if (/^(1|on|true|yes)$/i.test(process.env.RIDE_ADMIN_API ?? "")) {
  const secret = process.env.RIDE_ADMIN_TOKEN ?? "";
  if (secret.length < MIN_ADMIN_TOKEN || !publicUrl || !secureUrl) {
    process.stderr.write(
      `RIDE_ADMIN_API is on, but it needs RIDE_ADMIN_TOKEN of at least ${MIN_ADMIN_TOKEN} characters and RIDE_SERVER_URL as an https:// address: the provisioning API is off.\n`,
    );
  } else {
    admin = createAdminServer({ registry, token: secret, baseUrl: publicUrl });
    const adminHost = process.env.RIDE_ADMIN_HOST ?? "127.0.0.1";
    const adminPort = Number(process.env.RIDE_ADMIN_PORT ?? 8789);
    admin.http.listen(adminPort, adminHost, () =>
      process.stderr.write(`agentMotoride provisioning API listening on http://${adminHost}:${adminPort}/admin/v1\n`),
    );
  }
}
http.listen(port, host, () => process.stderr.write(`agentMotoride server listening on http://${host}:${port}/mcp\n`));
const timer = setInterval(() => void sweep(), 60_000);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void Promise.all([close(), admin?.close()]).then(() => process.exit(0));
  });
}
