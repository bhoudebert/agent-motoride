import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { tenantDbPath, tenantDir } from "./dataDir.ts";
import { CHANNEL, LiveShares, type LiveOptions } from "./live.ts";
import { join } from "node:path";
import { importLegacyPushed, importRoadbookFile, MAX_PUSHED_BYTES, PushRefused } from "./importRoadbook.ts";
import { keepRide, MAX_RIDE_BYTES, RIDE_ID, rideGpx, RideRefused, unzipUpload } from "./recordedRides.ts";
import { type MakeRoadbookFile, ReadyRoadbooks } from "./roadbookDownload.ts";
import { MAX_POINTS, TrafficFlow, type TrafficOptions } from "./traffic.ts";
import { type RequestContext, runInContext } from "./requestContext.ts";
import { valhallaMapDay } from "./http.ts";
import { createRideServer } from "./rideServer.ts";
import { Store } from "./store.ts";
import { createOAuth } from "./oauth.ts";
import type { z } from "zod";
import type { meSchema } from "./hostedContract.ts";
import { librarySize, type Registry, type Tenant } from "./tenants.ts";

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
  /** Open sessions per rider and in all (defaults 20 and 200). A rider at the limit closes the one unused longest to open another. */
  perRider?: number;
  total?: number;
  /** Bytes a request body may have (default 1 MiB). */
  maxBody?: number;
  version?: string;
  now?: () => number;
  /** Limits of the live sharing relay (ADR 0028). */
  live?: LiveOptions;
  /** The phone's traffic (ADR 0030, 0041, 0042): the provider, open data by default, and TomTom's key and daily budget. */
  traffic?: TrafficOptions;
  /** Makes the roadbook file of a saved ride; traces the route by default (tests give a fake). */
  makeRoadbookFile?: MakeRoadbookFile;
  /** The day the host's own Valhalla map was built, "" when it runs none; part of a roadbook's version. Tests give their own. */
  mapDay?: () => Promise<string>;
  /** How long a request for a roadbook with no file yet waits for it before answering 202, ms (20 s; tests give less). */
  firstFileWaitMs?: number;
  /** Sign-in for ChatGPT and Claude beside the bearer token (ADR 0056): off unless given the server's public address. */
  oauth?: { baseUrl: string; redirects?: string[]; log?: (line: string) => void };
}

interface Session {
  tenant: Tenant;
  transport: StreamableHTTPServerTransport;
  context: RequestContext;
  store: Store;
  lastUsed: number;
}

const ASSETS = fileURLToPath(new URL("../assets/follow/", import.meta.url));
const FOLLOW_HTML = readFileSync(`${ASSETS}index.html`);
const FOLLOW_JS = readFileSync(`${ASSETS}follow.js`);
/** Only this server and the map's own sources: the page decrypts positions, so nothing else may run in it. */
const FOLLOW_CSP = [
  "default-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org",
  "worker-src blob:",
  "child-src blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const sendFile = (res: ServerResponse, body: Buffer, type: string, headers: Record<string, string> = {}) => {
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", ...headers });
  res.end(body);
};

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

async function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new TooBig();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const bearer = (req: IncomingMessage): string | null => {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1]! : null;
};

export function createHttpServer(options: ServeOptions): {
  http: Server;
  sessions: Map<string, Session>;
  live: LiveShares;
  /** Close the sessions that have been idle too long; returns how many. */
  sweep(): Promise<number>;
  close(): Promise<void>;
} {
  const {
    registry,
    idleMs = 30 * 60_000,
    perMinute = 300,
    perRider = 20,
    total = 200,
    maxBody = 1024 * 1024,
    version = "0.1.0",
    now = Date.now,
  } = options;
  const live = new LiveShares({ now, ...options.live });
  const traffic = new TrafficFlow({ now, ...options.traffic });
  // A hosted rider on `open` has the open data whatever the host chose (ADR 0057).
  const trafficOpen = new TrafficFlow({ now, provider: "open-data", perDay: 0 });
  const roadbooks = new ReadyRoadbooks({
    make: options.makeRoadbookFile,
    mapDay: options.mapDay ?? valhallaMapDay,
    firstFileWaitMs: options.firstFileWaitMs,
  });
  const oauth = options.oauth ? createOAuth({ registry, now, ...options.oauth }) : null;
  const sessions = new Map<string, Session>();
  const windows = new Map<string, { start: number; count: number }>();

  const limited = (tenant: Tenant): boolean => {
    const t = now();
    const w = windows.get(tenant.id);
    if (!w || t - w.start >= 60_000) {
      windows.set(tenant.id, { start: t, count: 1 });
      return false;
    }
    return ++w.count > (tenant.entitlements?.requestsPerMinute ?? perMinute);
  };

  /** TomTom requests a hosted rider has used on a UTC day: a point of the phone's traffic, a call of the tool. */
  const spent = new Map<string, { day: string; count: number }>();
  const spentToday = (id: string): number => {
    const day = new Date(now()).toISOString().slice(0, 10);
    const s = spent.get(id);
    return s && s.day === day ? s.count : 0;
  };
  const spend = (id: string, n: number): void => {
    spent.set(id, { day: new Date(now()).toISOString().slice(0, 10), count: spentToday(id) + n });
  };
  const libraryFull = (tenant: Tenant, incoming: number): boolean => {
    const cap = tenant.entitlements?.libraryMb;
    return cap !== undefined && librarySize(tenant.id) + incoming > cap * 1_048_576;
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

  /** The relay of live sharing: the rider's side needs their token, the follower's side needs nothing but the channel. */
  async function handleShare(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const channel = url.pathname.slice("/share/".length);
    if (!CHANNEL.test(channel)) return json(res, 404, { error: "Not found" });

    if (req.method === "GET") {
      const t = now();
      const w = windows.get(`read:${channel}`);
      if (!w || t - w.start >= 60_000) windows.set(`read:${channel}`, { start: t, count: 1 });
      else if (++w.count > 120) return json(res, 429, { error: "Too many requests." }, { "Retry-After": "30" });
      const after = Number(url.searchParams.get("after") ?? 0);
      const read = live.read(channel, Number.isInteger(after) && after >= 0 ? after : 0);
      return read ? json(res, 200, read) : json(res, 404, { error: "No ride here." });
    }

    const token = bearer(req);
    const tenant = token ? registry.verify(token) : null;
    if (!tenant) return json(res, 401, { error: "A rider's token is needed." }, { "WWW-Authenticate": "Bearer" });
    if (limited(tenant)) return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "60" });

    if (req.method === "PUT") {
      const made = live.create(channel, tenant.id);
      if (made === "created") return json(res, 201, { ok: true });
      if (made === "same") return json(res, 200, { ok: true });
      if (made === "taken") return json(res, 409, { error: "That channel is taken." });
      if (made === "limit") return json(res, 429, { error: "Too many rides shared at once." }, { "Retry-After": "60" });
      return json(res, 400, { error: "Not a channel." });
    }
    if (req.method === "DELETE") {
      const mode = url.searchParams.get("mode") === "stop" ? "stop" : "end";
      return live.end(channel, tenant.id, mode) === "ok"
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "No ride here." });
    }
    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await readBody(req, 4096);
      } catch (e) {
        return e instanceof TooBig
          ? json(res, 413, { error: "Update too large." })
          : json(res, 400, { error: "Not JSON." });
      }
      const { iv, ct } = (typeof body === "object" && body !== null ? body : {}) as { iv?: unknown; ct?: unknown };
      const result = live.publish(channel, tenant.id, iv, ct);
      if (result.ok) return json(res, 200, { seq: result.seq });
      const status = { unknown: 404, forbidden: 404, "too-fast": 429, bad: 400, ended: 410 }[result.reason];
      return json(res, status, { error: result.reason }, status === 429 ? { "Retry-After": "2" } : {});
    }
    return json(res, 405, { error: "Method not allowed." }, { Allow: "GET, PUT, POST, DELETE" });
  }

  /** Traffic flow at a few points of the road ahead (ADR 0030): the rider's token, the host's provider. */
  async function handleTraffic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." }, { Allow: "POST" });
    const token = bearer(req);
    const tenant = token ? registry.verify(token) : null;
    if (!tenant) return json(res, 401, { error: "A rider's token is needed." }, { "WWW-Authenticate": "Bearer" });
    if (limited(tenant)) return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "60" });
    const mode = tenant.entitlements?.traffic;
    if (mode === "off") return json(res, 403, { error: "traffic_not_included" });
    const flow = mode === "open" ? trafficOpen : traffic;
    if (!flow.available) return json(res, 503, { error: "This server has no traffic source." });
    // A rider asks at most six times a minute: the phone asks every few minutes.
    const t = now();
    const w = windows.get(`traffic:${tenant.id}`);
    if (!w || t - w.start >= 60_000) windows.set(`traffic:${tenant.id}`, { start: t, count: 1 });
    else if (++w.count > 6)
      return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "30" });
    let body: unknown;
    try {
      body = await readBody(req, 2048);
    } catch (e) {
      return e instanceof TooBig ? json(res, 413, { error: "Too large." }) : json(res, 400, { error: "Not JSON." });
    }
    const raw = (
      typeof body === "object" && body !== null ? (body as { points?: unknown }).points : undefined
    ) as unknown;
    const valid =
      Array.isArray(raw) &&
      raw.length >= 1 &&
      raw.length <= MAX_POINTS &&
      raw.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          typeof p[0] === "number" &&
          typeof p[1] === "number" &&
          Math.abs(p[0]) <= 90 &&
          Math.abs(p[1]) <= 180,
      );
    if (!valid) return json(res, 400, { error: `One to ${MAX_POINTS} points [lat, lon] are needed.` });
    // A hosted rider on `tomtom` has an allowance of requests a day: a point is one.
    const allowance = mode === "tomtom" ? tenant.entitlements?.trafficPerDay : undefined;
    if (allowance !== undefined) {
      if (spentToday(tenant.id) + (raw as unknown[]).length > allowance)
        return json(res, 429, { error: "daily_limit" }, { "Retry-After": "3600" });
      spend(tenant.id, (raw as unknown[]).length);
    }
    const answer = await flow.flow(raw as Array<[number, number]>);
    return json(res, 200, { at: t, ...answer });
  }

  /** The rider's roadbooks for the phone: a list with version stamps, and one roadbook file (docs/roadbook-file.md). */
  async function handleRoadbooks(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const pushing = req.method === "PUT" && path === "/roadbooks";
    const refreshing = req.method === "POST" && /^\/roadbook\/\d{1,9}\/refresh$/.test(path);
    if (req.method !== "GET" && !pushing && !refreshing)
      return json(
        res,
        405,
        { error: "Method not allowed." },
        { Allow: path === "/roadbooks" ? "GET, PUT" : path.endsWith("/refresh") ? "POST" : "GET" },
      );
    const token = bearer(req);
    const tenant = token ? registry.verify(token) : null;
    if (!tenant) return json(res, 401, { error: "A rider's token is needed." }, { "WWW-Authenticate": "Bearer" });
    if (limited(tenant)) return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "60" });
    const file = /^\/roadbook\/(\d{1,9})$/.exec(path);
    const refresh = /^\/roadbook\/(\d{1,9})\/refresh$/.exec(path);
    if (path !== "/roadbooks" && !file && !refresh) return json(res, 404, { error: "Not found" });
    if (refresh && req.method !== "POST") return json(res, 405, { error: "Method not allowed." }, { Allow: "POST" });
    // The rider's library: what a phone lists, downloads, refreshes, and what a push is added to.
    const store = new Store(tenantDbPath(tenant.id));
    try {
      // Roadbooks pushed before they went into the library (files in a folder) are brought in once.
      importLegacyPushed(store, join(tenantDir(tenant.id), "pushed"));
      if (pushing) {
        // A rider pushes at most 10 files a minute.
        const t = now();
        const w = windows.get(`push:${tenant.id}`);
        if (!w || t - w.start >= 60_000) windows.set(`push:${tenant.id}`, { start: t, count: 1 });
        else if (++w.count > 10)
          return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "30" });
        let body: unknown;
        try {
          body = await readBody(req, MAX_PUSHED_BYTES);
        } catch (e) {
          return e instanceof TooBig ? json(res, 413, { error: "Too large." }) : json(res, 400, { error: "Not JSON." });
        }
        if (libraryFull(tenant, 0)) return json(res, 413, { error: "library_full" });
        try {
          const kept = importRoadbookFile(store, body);
          const stamp = (await roadbooks.list(tenant.id, store)).find((r) => r.id === kept.id)?.stamp ?? "";
          return json(res, 200, { ...kept, stamp });
        } catch (e) {
          if (e instanceof PushRefused) return json(res, e.status, { error: e.message });
          console.error(`[roadbook push] ${e instanceof Error ? e.message : String(e)}`);
          return json(res, 500, { error: "The roadbook file could not be kept." });
        }
      }
      // A refresh traces a roadbook again: a rider asks for at most 20 a minute.
      if (refresh) {
        const t = now();
        const w = windows.get(`refresh:${tenant.id}`);
        if (!w || t - w.start >= 60_000) windows.set(`refresh:${tenant.id}`, { start: t, count: 1 });
        else if (++w.count > 20)
          return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "30" });
        const state = await roadbooks.refresh(tenant.id, store, Number(refresh[1]));
        if (state === null) return json(res, 404, { error: "No such roadbook." });
        return json(res, state === "refreshing" || state === "outdated" ? 202 : 200, { id: Number(refresh[1]), state });
      }
      // A file is served from disk and costs nothing; the first one of a roadbook traces it. A rider asks for at most 30 a minute.
      if (file) {
        const t = now();
        const w = windows.get(`roadbook:${tenant.id}`);
        if (!w || t - w.start >= 60_000) windows.set(`roadbook:${tenant.id}`, { start: t, count: 1 });
        else if (++w.count > 30)
          return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "30" });
      }
      if (!file) return json(res, 200, { roadbooks: await roadbooks.list(tenant.id, store) });
      const made = await roadbooks.get(tenant.id, store, Number(file[1]));
      if (!made) return json(res, 404, { error: "No such roadbook." });
      // A long route's first file is still being made: the phone is told so, before a gateway gives up on the request.
      if (made === "preparing")
        return json(res, 202, { id: Number(file[1]), state: "refreshing" }, { "Retry-After": "5" });
      const etag = `"${made.stamp}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag });
        return void res.end();
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        "Cache-Control": "private, no-cache",
      });
      return void res.end(made.body);
    } catch (e) {
      console.error(`[roadbook] ${e instanceof Error ? e.message : String(e)}`);
      return json(res, 502, { error: "The roadbook file could not be made right now; try again." });
    } finally {
      store.close();
    }
  }

  /** The rides a rider recorded and uploaded (ADR 0054): kept in their library, listed, read back, deleted here only. */
  async function handleRides(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const one = /^\/rides\/([^/]+)$/.exec(path);
    if (path !== "/rides" && !one) return json(res, 404, { error: "Not found" });
    const allowed = path === "/rides" ? ["GET"] : ["GET", "PUT", "DELETE"];
    if (!allowed.includes(req.method ?? ""))
      return json(res, 405, { error: "Method not allowed." }, { Allow: allowed.join(", ") });
    const token = bearer(req);
    const tenant = token ? registry.verify(token) : null;
    if (!tenant) return json(res, 401, { error: "A rider's token is needed." }, { "WWW-Authenticate": "Bearer" });
    if (limited(tenant)) return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "60" });
    let id = "";
    if (one) {
      try {
        id = decodeURIComponent(one[1]!);
      } catch {
        return json(res, 400, { error: "Bad ride id." });
      }
      if (!RIDE_ID.test(id)) return json(res, 400, { error: "Bad ride id." });
    }
    const store = new Store(tenantDbPath(tenant.id));
    try {
      if (!one) return json(res, 200, { rides: store.listRecordedRides() });
      if (req.method === "PUT") {
        // A rider uploads at most 10 rides a minute.
        const t = now();
        const w = windows.get(`ride:${tenant.id}`);
        if (!w || t - w.start >= 60_000) windows.set(`ride:${tenant.id}`, { start: t, count: 1 });
        else if (++w.count > 10)
          return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "30" });
        try {
          const raw = await readRaw(req, MAX_RIDE_BYTES);
          if (libraryFull(tenant, raw.length)) return json(res, 413, { error: "library_full" });
          const encoding = req.headers["content-encoding"];
          const gpx = unzipUpload(raw, Array.isArray(encoding) ? encoding[0] : encoding).toString("utf8");
          const kept = keepRide(store, id, gpx);
          return json(res, kept.status === "created" ? 201 : 200, {
            id,
            status: kept.status,
            roadbook: store.listRecordedRides().find((r) => r.id === id)?.roadbook ?? null,
          });
        } catch (e) {
          if (e instanceof TooBig) return json(res, 413, { error: "Too large." });
          if (e instanceof RideRefused) return json(res, e.status, { error: e.message });
          console.error(`[ride upload] ${e instanceof Error ? e.message : String(e)}`);
          return json(res, 500, { error: "The ride could not be kept." });
        }
      }
      if (req.method === "DELETE") {
        return store.deleteRecordedRide(id)
          ? json(res, 200, { id, deleted: true })
          : json(res, 404, { error: "No such ride." });
      }
      const gpx = rideGpx(store, id);
      if (gpx === undefined) return json(res, 404, { error: "No such ride." });
      res.writeHead(200, {
        "Content-Type": "application/gpx+xml; charset=utf-8",
        "Cache-Control": "private, no-cache",
      });
      return void res.end(gpx);
    } finally {
      store.close();
    }
  }

  /** A phone exchanges the code of its invitation (and the PIN, when there is one) for a token of its own. */
  async function handleEnrol(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." }, { Allow: "POST" });
    // Whoever asks, only so many tries a minute in all: the code is 192 random bits and the PIN counts its own tries.
    const t = now();
    const w = windows.get("enrol");
    if (!w || t - w.start >= 60_000) windows.set("enrol", { start: t, count: 1 });
    else if (++w.count > 30)
      return json(res, 429, { error: "Too many tries; wait a minute." }, { "Retry-After": "60" });
    let body: unknown;
    try {
      body = await readBody(req, 1024);
    } catch (e) {
      return e instanceof TooBig ? json(res, 413, { error: "Too large." }) : json(res, 400, { error: "Not JSON." });
    }
    const { code, pin } = (typeof body === "object" && body !== null ? body : {}) as { code?: unknown; pin?: unknown };
    if (typeof code !== "string" || (pin !== undefined && typeof pin !== "string"))
      return json(res, 400, { error: "A code is needed." });
    const result = registry.redeem(code, pin, now());
    if (result.ok) return json(res, 200, { token: result.token });
    if (result.reason === "pin") return json(res, 403, { error: "pin", triesLeft: result.triesLeft });
    if (result.reason === "locked") return json(res, 403, { error: "locked" });
    return json(res, 404, { error: "invalid" });
  }

  /** What the rider may use, for the app to show or hide a feature and say why (ADR 0057, spec hosted-provisioning). */
  function handleMe(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." }, { Allow: "GET" });
    const token = bearer(req);
    // A paused rider still gets an answer, saying so: the app shows "your server is paused", not "bad token".
    const tenant = token ? (registry.verifyAny(token) ?? oauth?.verify(token) ?? null) : null;
    if (!tenant) return json(res, 401, { error: "A rider's token is needed." }, { "WWW-Authenticate": "Bearer" });
    if (limited(tenant)) return json(res, 429, { error: "Too many requests; wait a minute." }, { "Retry-After": "60" });
    const ent = tenant.entitlements ?? {};
    const provider = ent.traffic === "off" ? null : ent.traffic === "open" ? trafficOpen.kind : traffic.kind;
    const answer: z.infer<typeof meSchema> = {
      hosted: tenant.ref !== undefined,
      riderRef: `rr-${tenant.id.replaceAll("-", "").slice(0, 16)}`,
      ...(tenant.status === "suspended"
        ? { suspended: { reason: tenant.suspension?.reason ?? "lapsed", until: tenant.suspension?.until ?? null } }
        : {}),
      traffic: {
        mode: ent.traffic ?? "host",
        perDay: ent.traffic === "tomtom" ? (ent.trafficPerDay ?? null) : null,
        usedToday: spentToday(tenant.id),
        ...(provider ? { provider } : {}),
      },
      library: { limitMb: ent.libraryMb ?? null, usedBytes: librarySize(tenant.id) },
      requestsPerMinute: ent.requestsPerMinute ?? perMinute,
    };
    return json(res, 200, answer);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/enrol") return handleEnrol(req, res);
    if (url.pathname === "/health")
      return json(res, 200, {
        ok: true,
        version,
        sessions: sessions.size,
        shares: live.size,
        traffic: traffic.available,
        trafficCountries: traffic.countries,
        oauth: oauth !== null,
      });
    if (oauth && (await oauth.handle(req, res, url))) return;
    if (url.pathname === "/me") return handleMe(req, res);
    if (url.pathname === "/traffic") return handleTraffic(req, res);
    if (url.pathname === "/roadbooks" || url.pathname.startsWith("/roadbook/"))
      return handleRoadbooks(req, res, url.pathname);
    if (url.pathname === "/rides" || url.pathname.startsWith("/rides/")) return handleRides(req, res, url.pathname);
    if (url.pathname === "/follow.js" && req.method === "GET")
      return sendFile(res, FOLLOW_JS, "text/javascript; charset=utf-8");
    // The page is the same for every link, so it says nothing of whether a ride exists.
    if (url.pathname.startsWith("/follow/") && req.method === "GET") {
      return sendFile(res, FOLLOW_HTML, "text/html; charset=utf-8", {
        "Content-Security-Policy": FOLLOW_CSP,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
    }
    if (url.pathname.startsWith("/share/")) return handleShare(req, res, url);
    if (url.pathname !== "/mcp") return json(res, 404, { error: "Not found" });

    // The rider's token (Claude Code, Codex, the phone) or, when sign-in for chat assistants is on, a connection's token.
    const token = bearer(req);
    const tenant = token ? (registry.verify(token) ?? oauth?.verify(token) ?? null) : null;
    if (!tenant)
      return json(
        res,
        401,
        { error: "A rider's token is needed." },
        { "WWW-Authenticate": oauth?.challenge ?? "Bearer" },
      );
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
      // A chat assistant opens a session for each conversation and reconnection and never closes it: at the limit the rider's
      // own session unused longest is closed (its client opens another by itself), so a new connection is not refused.
      const mine = [...sessions].filter(([, s]) => s.tenant.id === tenant.id);
      if (sessions.size >= total && mine.length < perRider)
        return json(res, 429, { error: "Too many open sessions." }, { "Retry-After": "60" });
      if (mine.length >= perRider) await drop(mine.sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]![0]);
      const context: RequestContext = {
        fileRoot: tenantDir(tenant.id),
        // The plan is read at each call: a change made while the session is open applies at once.
        trafficGate: () => {
          const ent = registry.find(tenant.id)?.entitlements;
          if (ent?.traffic === undefined) return "ok";
          if (ent.traffic !== "tomtom") return "not_included";
          if (ent.trafficPerDay !== undefined) {
            if (spentToday(tenant.id) >= ent.trafficPerDay) return "daily_limit";
            spend(tenant.id, 1);
          }
          return "ok";
        },
      };
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
        const { server, restoreHome } = createRideServer(store, { home: "" });
        // The start point the rider saved in their library, so a session need not be told it again.
        await restoreHome();
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
    live,
    async sweep() {
      live.sweep();
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
