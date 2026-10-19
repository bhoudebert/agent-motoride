import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { tenantDbPath, tenantDir } from "./dataDir.ts";
import { type RequestContext, runInContext } from "./requestContext.ts";
import { createRideServer } from "./rideServer.ts";
import { Store } from "./store.ts";
import type { Registry, Tenant } from "./tenants.ts";

/**
 * The MCP tools over HTTP for several riders (ADR 0027, spec multi-user-server): a rider's token in `Authorization: Bearer`
 * chooses their library, each MCP session is one rider's, and what a tool writes or reads is confined to their folder.
 * TLS belongs to the proxy in front (Caddy); this speaks plain HTTP on the address it is given.
 */
export interface ServeOptions {
  registry: Registry;
  /** Sessions idle this long are closed (default 30 minutes). */
  idleMs?: number;
  /** Requests per rider per minute (default 300). */
  perMinute?: number;
  /** Open sessions per rider and in all (defaults 5 and 200). */
  perRider?: number;
  total?: number;
  /** Bytes a request body may have (default 1 MiB). */
  maxBody?: number;
  version?: string;
  now?: () => number;
}

interface Session {
  tenant: Tenant;
  transport: StreamableHTTPServerTransport;
  context: RequestContext;
  store: Store;
  lastUsed: number;
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};

class TooBig extends Error {}

async function readBody(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new TooBig();
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const bearer = (req: IncomingMessage): string | null => {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1]! : null;
};

export function createHttpServer(options: ServeOptions): {
  http: Server;
  sessions: Map<string, Session>;
  /** Close the sessions that have been idle too long; returns how many. */
  sweep(): Promise<number>;
  close(): Promise<void>;
} {
  const {
    registry,
    idleMs = 30 * 60_000,
    perMinute = 300,
    perRider = 5,
    total = 200,
    maxBody = 1024 * 1024,
    version = "0.1.0",
    now = Date.now,
  } = options;
  const sessions = new Map<string, Session>();
  const windows = new Map<string, { start: number; count: number }>();

  const limited = (tenant: Tenant): boolean => {
    const t = now();
    const w = windows.get(tenant.id);
    if (!w || t - w.start >= 60_000) {
      windows.set(tenant.id, { start: t, count: 1 });
      return false;
    }
    return ++w.count > perMinute;
  };

  const drop = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    try {
      await session.transport.close();
    } catch {
      // Already closed.
    }
    session.store.close();
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/health") return json(res, 200, { ok: true, version, sessions: sessions.size });
    if (url.pathname !== "/mcp") return json(res, 404, { error: "Not found" });

    const token = bearer(req);
    const tenant = token ? registry.verify(token) : null;
    if (!tenant) return json(res, 401, { error: "A rider's token is needed." }, { "WWW-Authenticate": "Bearer" });
    if (limited(tenant)) return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "60" });

    let body: unknown;
    if (req.method === "POST") {
      try {
        body = await readBody(req, maxBody);
      } catch (e) {
        return e instanceof TooBig
          ? json(res, 413, { error: "Request too large." })
          : json(res, 400, { error: "Not JSON." });
      }
    }

    const sid = req.headers["mcp-session-id"];
    const id = Array.isArray(sid) ? sid[0] : sid;
    let session = id ? sessions.get(id) : undefined;
    // A session belongs to the rider who opened it: another rider's token never reaches it, and never learns it exists.
    if (id && (!session || session.tenant.id !== tenant.id)) return json(res, 404, { error: "Session not found." });

    if (!session) {
      if (req.method !== "POST" || !isInitializeRequest(body))
        return json(res, 400, { error: "No session: initialise first." });
      const mine = [...sessions.values()].filter((s) => s.tenant.id === tenant.id).length;
      if (sessions.size >= total || mine >= perRider)
        return json(res, 429, { error: "Too many open sessions." }, { "Retry-After": "60" });
      const context: RequestContext = { fileRoot: tenantDir(tenant.id) };
      const store = new Store(tenantDbPath(tenant.id));
      const opened: Session = {
        tenant,
        context,
        store,
        lastUsed: now(),
        transport: new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            sessions.set(sessionId, opened);
          },
        }),
      };
      opened.transport.onclose = () => {
        const sessionId = opened.transport.sessionId;
        if (sessionId) void drop(sessionId);
      };
      await runInContext(context, async () => {
        const { server } = createRideServer(store, { home: "" });
        await server.connect(opened.transport);
      });
      session = opened;
    }
    session.lastUsed = now();
    await runInContext(session.context, () => session!.transport.handleRequest(req, res, body));
  }

  const http = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      process.stderr.write(`request failed: ${error instanceof Error ? error.message : String(error)}\n`);
      if (!res.headersSent) json(res, 500, { error: "Something went wrong." });
      else res.end();
    });
  });

  return {
    http,
    sessions,
    async sweep() {
      const idle = [...sessions].filter(([, s]) => now() - s.lastUsed >= idleMs).map(([sid]) => sid);
      for (const sid of idle) await drop(sid);
      return idle.length;
    },
    async close() {
      for (const sid of [...sessions.keys()]) await drop(sid);
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
