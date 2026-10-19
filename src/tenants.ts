import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertTenantId, DATA_DIR, tenantDbPath, tenantDir } from "./dataDir.ts";

/** Several riders on one instance, each with a library of their own, found by token (ADR 0027, spec multi-user-server). */

export type TenantStatus = "active" | "suspended";

export interface Tenant {
  id: string;
  email: string;
  status: TenantStatus;
  createdAt: string;
  lastSeenAt: string | null;
}

const REGISTRY = process.env.RIDE_REGISTRY ?? resolve(DATA_DIR, "registry.db");
const TOKEN_PREFIX = "mrt_";
/** `lastSeenAt` is written at most this often per tenant, so a busy client does not write on every call. */
const SEEN_EVERY_MS = 60_000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = (): string => TOKEN_PREFIX + randomBytes(32).toString("base64url");
/** A random UUID (122 random bits): not a counter, not made from the email, and impossible to guess. */
const newId = (): string => randomUUID();
export const newInviteCode = (): string => "mri_" + randomBytes(24).toString("base64url");
/** An invitation lives this long unless the administrator says otherwise, and a wrong PIN burns it after this many tries. */
export const INVITE_HOURS = 24;
export const PIN_TRIES = 3;
const PIN = /^\d{6}$/;
const pinHash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString("hex");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Row {
  id: string;
  email: string;
  status: TenantStatus;
  created_at: string;
  last_seen_at: string | null;
}
const tenantOf = (r: Row): Tenant => ({
  id: r.id,
  email: r.email,
  status: r.status,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
});

export class Registry {
  readonly path: string;
  #db: DatabaseSync;
  #seen = new Map<string, number>();

  constructor(path = REGISTRY) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      -- A phone's own token (made when an invitation is redeemed), apart from the token of Claude Code or Codex.
      CREATE TABLE IF NOT EXISTS device_tokens (
        token_hash TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        pin_salt TEXT,
        pin_hash TEXT,
        tries INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );`);
  }

  close(): void {
    this.#db.close();
  }

  /** Register a rider. The token is returned once and only its hash is kept. */
  add(email: string): { tenant: Tenant; token: string } {
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean)) throw new Error(`"${email}" is not an email address.`);
    if (this.#db.prepare("SELECT 1 FROM tenants WHERE email = ?").get(clean)) {
      throw new Error(`${clean} is already registered.`);
    }
    const id = newId();
    const token = newToken();
    const createdAt = new Date().toISOString();
    this.#db
      .prepare("INSERT INTO tenants (id, email, token_hash, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(id, clean, hash(token), createdAt);
    return { tenant: { id, email: clean, status: "active", createdAt, lastSeenAt: null }, token };
  }

  list(): Tenant[] {
    return (this.#db.prepare("SELECT * FROM tenants ORDER BY created_at, email").all() as unknown as Row[]).map(
      tenantOf,
    );
  }

  /** A tenant by identifier or by email. */
  find(idOrEmail: string): Tenant | null {
    const row = this.#db
      .prepare("SELECT * FROM tenants WHERE id = ? OR email = ?")
      .get(idOrEmail, idOrEmail.trim().toLowerCase()) as unknown as Row | undefined;
    return row ? tenantOf(row) : null;
  }

  private need(idOrEmail: string): Tenant {
    const tenant = this.find(idOrEmail);
    if (!tenant) throw new Error(`No tenant matches "${idOrEmail}". Run: npm run admin -- list`);
    return tenant;
  }

  /** Who a token identifies: an active tenant, or nobody. */
  verify(token: string): Tenant | null {
    if (!token.startsWith(TOKEN_PREFIX) || token.length < 20 || token.length > 100) return null;
    const h = hash(token);
    const row = this.#db
      .prepare(
        `SELECT * FROM tenants WHERE token_hash = ?1
         OR id = (SELECT tenant_id FROM device_tokens WHERE token_hash = ?1)`,
      )
      .get(h) as unknown as Row | undefined;
    // The hash is looked up, never the token compared; the check below is for the status alone.
    if (!row || row.status !== "active") return null;
    const now = Date.now();
    if (now - (this.#seen.get(row.id) ?? 0) >= SEEN_EVERY_MS) {
      this.#seen.set(row.id, now);
      this.#db.prepare("UPDATE tenants SET last_seen_at = ? WHERE id = ?").run(new Date(now).toISOString(), row.id);
    }
    return tenantOf(row);
  }

  setStatus(idOrEmail: string, status: TenantStatus): Tenant {
    const tenant = this.need(idOrEmail);
    this.#db.prepare("UPDATE tenants SET status = ? WHERE id = ?").run(status, tenant.id);
    return { ...tenant, status };
  }

  /** A new token; the old one stops working at once. */
  rekey(idOrEmail: string): { tenant: Tenant; token: string } {
    const tenant = this.need(idOrEmail);
    const token = newToken();
    this.#db.prepare("UPDATE tenants SET token_hash = ? WHERE id = ?").run(hash(token), tenant.id);
    return { tenant, token };
  }

  /** Forget a tenant: its token stops working. What happens to its library is the caller's to do (`removeLibrary`). */
  remove(idOrEmail: string): Tenant {
    const tenant = this.need(idOrEmail);
    this.#db.prepare("DELETE FROM tenants WHERE id = ?").run(tenant.id);
    this.#db.prepare("DELETE FROM device_tokens WHERE tenant_id = ?").run(tenant.id);
    this.#db.prepare("DELETE FROM invites WHERE tenant_id = ?").run(tenant.id);
    return tenant;
  }

  /**
   * An invitation for a rider's phone: a one-time code, valid for `hours` (default 24), and a PIN of six digits when asked
   * for, which the server checks. The code is shown once and only its hash is kept. A rider not yet registered is.
   */
  invite(
    email: string,
    options: { pin?: boolean; hours?: number; now?: number } = {},
  ): { tenant: Tenant; code: string; pin: string | null; expiresAt: string; created: boolean } {
    const hours = options.hours ?? INVITE_HOURS;
    if (!(hours > 0 && hours <= 24 * 30)) throw new Error("The hours of an invitation are between 1 and 720.");
    const known = this.find(email);
    const tenant = known ?? this.add(email).tenant;
    const now = options.now ?? Date.now();
    const code = newInviteCode();
    const pin = options.pin ? String(randomInt(0, 1_000_000)).padStart(6, "0") : null;
    const salt = randomBytes(16).toString("hex");
    const expiresAt = new Date(now + hours * 3_600_000).toISOString();
    this.#db
      .prepare(
        `INSERT INTO invites (id, code_hash, tenant_id, pin_salt, pin_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        hash(code),
        tenant.id,
        pin ? salt : null,
        pin ? pinHash(pin, salt) : null,
        expiresAt,
        new Date(now).toISOString(),
      );
    return { tenant, code, pin, expiresAt, created: !known };
  }

  /**
   * Exchange an invitation for a token of the phone's own. An unknown, expired or used code all answer `invalid`; a wrong
   * PIN counts, and the third burns the invitation. A missing PIN is not a try.
   */
  redeem(
    code: string,
    pin?: string,
    now = Date.now(),
  ):
    | { ok: true; tenant: Tenant; token: string }
    | { ok: false; reason: "invalid" | "pin" | "locked"; triesLeft?: number } {
    if (!code.startsWith("mri_") || code.length < 20 || code.length > 100) return { ok: false, reason: "invalid" };
    const row = this.#db.prepare("SELECT * FROM invites WHERE code_hash = ?").get(hash(code)) as unknown as
      | {
          id: string;
          tenant_id: string;
          pin_salt: string | null;
          pin_hash: string | null;
          tries: number;
          expires_at: string;
          used_at: string | null;
        }
      | undefined;
    if (!row || row.used_at || Date.parse(row.expires_at) <= now) return { ok: false, reason: "invalid" };
    if (row.tries >= PIN_TRIES) return { ok: false, reason: "locked" };
    const tenant = this.find(row.tenant_id);
    if (!tenant || tenant.status !== "active") return { ok: false, reason: "invalid" };
    if (row.pin_hash && row.pin_salt) {
      if (pin === undefined || pin === "") return { ok: false, reason: "pin", triesLeft: PIN_TRIES - row.tries };
      const good = PIN.test(pin) && timingSafeEqual(Buffer.from(pinHash(pin, row.pin_salt)), Buffer.from(row.pin_hash));
      if (!good) {
        const tries = row.tries + 1;
        this.#db.prepare("UPDATE invites SET tries = ? WHERE id = ?").run(tries, row.id);
        return tries >= PIN_TRIES
          ? { ok: false, reason: "locked" }
          : { ok: false, reason: "pin", triesLeft: PIN_TRIES - tries };
      }
    }
    const token = newToken();
    this.#db.prepare("UPDATE invites SET used_at = ? WHERE id = ?").run(new Date(now).toISOString(), row.id);
    this.#db
      .prepare("INSERT INTO device_tokens (token_hash, tenant_id, created_at) VALUES (?, ?, ?)")
      .run(hash(token), tenant.id, new Date(now).toISOString());
    return { ok: true, tenant, token };
  }

  /** Forget the phones' tokens of a rider (their other devices stop working); the invitations that are not used go too. */
  revokeDevices(idOrEmail: string): number {
    const tenant = this.need(idOrEmail);
    this.#db.prepare("DELETE FROM invites WHERE tenant_id = ? AND used_at IS NULL").run(tenant.id);
    return Number(this.#db.prepare("DELETE FROM device_tokens WHERE tenant_id = ?").run(tenant.id).changes);
  }

  /** A consistent copy of the registry into `dest`. */
  backupTo(dest: string): void {
    mkdirSync(dirname(dest), { recursive: true });
    this.#db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  }
}

/** The size of a tenant's library in bytes, 0 before it is first used. */
export function librarySize(id: string): number {
  const path = tenantDbPath(id);
  return existsSync(path) ? statSync(path).size : 0;
}

/** Take a removed tenant's library aside (`data/removed/<id>-<date>`), or delete it with `purge`. Returns where it went. */
export function removeLibrary(id: string, purge: boolean, now = new Date()): string | null {
  const dir = tenantDir(assertTenantId(id));
  if (!existsSync(dir)) return null;
  if (purge) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const dest = resolve(DATA_DIR, "removed", `${id}-${now.toISOString().slice(0, 10)}`);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(dir, dest);
  return dest;
}

/** A consistent copy of the registry and of every tenant's library into `<dir>/<date>/`. Returns what was copied. */
export function backupAll(registry: Registry, dir: string, now = new Date()): { folder: string; copied: string[] } {
  const folder = resolve(dir, now.toISOString().replace(/[:.]/g, "-").slice(0, 19));
  mkdirSync(folder, { recursive: true });
  const copied: string[] = [];
  registry.backupTo(resolve(folder, "registry.db"));
  copied.push("registry.db");
  const root = resolve(DATA_DIR, "tenants");
  for (const id of existsSync(root) ? readdirSync(root) : []) {
    const db = tenantDbPath(id);
    if (!existsSync(db)) continue;
    const source = new DatabaseSync(db);
    try {
      source.exec("PRAGMA busy_timeout = 10000");
      mkdirSync(resolve(folder, "tenants", id), { recursive: true });
      source.exec(`VACUUM INTO '${resolve(folder, "tenants", id, "agentmotoride.db").replace(/'/g, "''")}'`);
      copied.push(`tenants/${id}`);
    } finally {
      source.close();
    }
  }
  return { folder, copied };
}
