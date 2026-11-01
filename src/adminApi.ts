import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { parseEntitlements, REF } from "./entitlements.ts";
import {
  createBodySchema,
  deletedSchema,
  invitationBodySchema,
  invitationSchema,
  revokedSchema,
  riderSchema,
  suspendBodySchema,
  type errorSchema,
} from "./hostedContract.ts";
import { inviteLink } from "./inviteLink.ts";
import { librarySize, removeLibrary, type Registry, type Tenant } from "./tenants.ts";
import type { z } from "zod";

/** The provisioning API (ADR 0057, spec hosted-provisioning): how a program that sells hosted servers runs the riders on this one. */
export interface AdminOptions {
  registry: Registry;
  /** RIDE_ADMIN_TOKEN: at least 32 characters. */
  token: string;
  /** The public address of the server, for the link of an invitation. */
  baseUrl: string;
  now?: () => number;
  /** Where the one line per call goes: method, action, a short hash of the reference, status. Never a token or a reference. */
  log?: (line: string) => void;
}

export const MIN_ADMIN_TOKEN = 32;
const MAX_BODY = 4096;

const digest = (value: string) => createHash("sha256").update(value).digest();
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
const fail = (res: ServerResponse, status: number, error: string, detail?: string) =>
  send(res, status, { error, ...(detail ? { detail } : {}) } satisfies z.infer<typeof errorSchema>);

async function readJson(req: IncomingMessage): Promise<unknown | "too-big" | "bad"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return "too-big";
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return "bad";
  }
}

export function createAdminServer(options: AdminOptions): { http: Server; close(): Promise<void> } {
  const { registry, now = Date.now, log = (line: string) => process.stderr.write(`${line}\n`) } = options;
  if (options.token.length < MIN_ADMIN_TOKEN)
    throw new Error(`RIDE_ADMIN_TOKEN needs at least ${MIN_ADMIN_TOKEN} characters.`);
  const secret = digest(options.token);

  const view = (tenant: Tenant): z.infer<typeof riderSchema> =>
    riderSchema.parse({
      ref: tenant.ref,
      id: tenant.id,
      status: tenant.status,
      entitlements: tenant.entitlements ?? {},
      libraryBytes: librarySize(tenant.id),
      createdAt: tenant.createdAt,
      lastSeenAt: tenant.lastSeenAt,
      devices: registry.devices(tenant.id).count,
      enrolledAt: registry.devices(tenant.id).since,
    });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const header = req.headers.authorization;
    const given = header ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : undefined;
    if (!given || !timingSafeEqual(digest(given), secret)) {
      log(`[admin] ${req.method} - - 401`);
      return fail(res, 401, "unauthorized");
    }
    const match = /^\/admin\/v1\/riders\/([^/]+)(?:\/(invitation|entitlements|suspend|resume|devices))?$/.exec(
      url.pathname,
    );
    const ref = ((): string => {
      try {
        return match ? decodeURIComponent(match[1]!) : "";
      } catch {
        return "";
      }
    })();
    const action = match?.[2] ?? "rider";
    const short = ref ? createHash("sha256").update(ref).digest("hex").slice(0, 8) : "-";
    const reply = (status: number, body: unknown): void => {
      log(`[admin] ${req.method} ${action} ${short} ${status}`);
      send(res, status, body);
    };
    const refuse = (status: number, error: string, detail?: string): void => {
      log(`[admin] ${req.method} ${action} ${short} ${status}`);
      fail(res, status, error, detail);
    };
    if (!match) return refuse(404, "not_found");
    if (!REF.test(ref)) return refuse(400, "invalid_ref", "The reference is 8 to 128 letters, digits, . _ : -");

    const method = req.method ?? "";
    const allowed: Record<string, string[]> = {
      rider: ["PUT", "GET", "DELETE"],
      invitation: ["POST"],
      entitlements: ["PUT"],
      suspend: ["POST"],
      resume: ["POST"],
      devices: ["DELETE"],
    };
    if (!allowed[action]!.includes(method)) return refuse(405, "method_not_allowed");

    const body = method === "GET" || method === "DELETE" ? {} : await readJson(req);
    if (body === "too-big") return refuse(413, "too_large");
    if (body === "bad") return refuse(400, "not_json");

    if (action === "rider" && method === "PUT") {
      const parsed = createBodySchema.safeParse(body);
      if (!parsed.success) {
        const given = (body as { entitlements?: unknown } | null)?.entitlements;
        const checked = given === undefined ? null : parseEntitlements(given);
        return refuse(400, "invalid_entitlements", checked && !checked.ok ? checked.error : "The body is not valid.");
      }
      const { tenant, created } = registry.provision(ref);
      const set = parsed.data.entitlements ? registry.setEntitlements(tenant.id, parsed.data.entitlements) : tenant;
      return reply(created ? 201 : 200, view(set));
    }

    const tenant = registry.findByRef(ref);
    if (!tenant) return refuse(404, "not_found");

    if (action === "rider" && method === "GET") return reply(200, view(tenant));
    if (action === "rider" && method === "DELETE") {
      registry.remove(tenant.id);
      removeLibrary(tenant.id, true);
      return reply(200, deletedSchema.parse({ ref, deleted: true }));
    }
    if (action === "entitlements") {
      const parsed = parseEntitlements(body);
      if (!parsed.ok) return refuse(400, "invalid_entitlements", parsed.error);
      return reply(200, view(registry.setEntitlements(tenant.id, parsed.value)));
    }
    if (action === "devices")
      return reply(200, revokedSchema.parse({ ref, revoked: registry.revokeDevices(tenant.id) }));
    if (action === "resume") return reply(200, view(registry.setStatus(tenant.id, "active")));
    if (action === "suspend") {
      const asked = suspendBodySchema.safeParse(body);
      if (!asked.success)
        return refuse(400, "invalid_suspension", "reason is a short word, until is an ISO date and time");
      return reply(
        200,
        view(
          registry.setStatus(tenant.id, "suspended", {
            reason: asked.data.reason ?? "lapsed",
            until: asked.data.until,
          }),
        ),
      );
    }
    // action === "invitation"
    const asked = invitationBodySchema.safeParse(body);
    if (!asked.success) return refuse(400, "invalid_minutes", "minutes is a whole number from 1 to 60");
    if (tenant.status !== "active") return refuse(409, "suspended");
    const made = registry.inviteTenant(tenant.id, asked.data.minutes ?? 15, now());
    if (!made) return refuse(409, "suspended");
    return reply(
      200,
      invitationSchema.parse({
        code: made.code,
        link: inviteLink(options.baseUrl, made.code),
        expiresAt: made.expiresAt,
      }),
    );
  }

  const http = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      process.stderr.write(`admin request failed: ${error instanceof Error ? error.message : String(error)}\n`);
      if (!res.headersSent) fail(res, 500, "server_error");
      else res.end();
    });
  });
  return { http, close: () => new Promise<void>((resolve) => http.close(() => resolve())) };
}
