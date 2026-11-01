import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertTenantId, DATA_DIR, tenantDbPath, tenantDir } from "./dataDir.ts";
import { type Entitlements, entitlementsSchema } from "./entitlements.ts";

/** Several riders on one instance, each with a library of their own, found by token (ADR 0027, spec multi-user-server). */

export type TenantStatus = "active" | "suspended";

export interface Tenant {
  id: string;
  email: string;
  status: TenantStatus;
  createdAt: string;
  lastSeenAt: string | null;
  /** The reference of a rider made by the provisioning API (ADR 0057); absent for a rider an administrator added. */
  ref?: string;
  /** What a hosted rider may use; absent when none is set. */
  entitlements?: Entitlements;
  /** Why a hosted rider is suspended, and until when, as the program that sells the plans said; absent otherwise. */
  suspension?: Suspension;
}

export interface Suspension {
  reason: string;
  until: string | null;
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
/** What a chat connection lives: an access token an hour, a refresh token 90 days (rotated at each use), a code minutes. */
export const LINK_CODE_MINUTES = 10;
const AUTH_CODE_MINUTES = 5;
const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 90;
const MAX_CLIENTS = 2000;
/** Letters and digits that are not mistaken for each other when read from a screen and typed: 8 of 30 is 39 bits. */
const LINK_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const linkCodeOf = (): string => {
  let code = "";
  for (let i = 0; i < 8; i++) code += LINK_ALPHABET[randomInt(0, LINK_ALPHABET.length)];
  return code;
};
const cleanLinkCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const iso = (ms: number): string => new Date(ms).toISOString();
const pinHash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString("hex");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Row {
  id: string;
  email: string;
  status: TenantStatus;
  created_at: string;
  last_seen_at: string | null;
  external_ref?: string | null;
  entitlements?: string | null;
  suspension?: string | null;
}
const suspensionOf = (json: string | null | undefined): Suspension | undefined => {
  if (!json) return undefined;
  try {
    const v = JSON.parse(json) as Partial<Suspension>;
    return typeof v.reason === "string"
      ? { reason: v.reason, until: typeof v.until === "string" ? v.until : null }
      : undefined;
  } catch {
    return undefined;
  }
};
const entitlementsOf = (json: string | null | undefined): Entitlements | undefined => {
  if (!json) return undefined;
  try {
    const parsed = entitlementsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};
const tenantOf = (r: Row): Tenant => {
  const entitlements = entitlementsOf(r.entitlements);
  const suspension = r.status === "suspended" ? suspensionOf(r.suspension) : undefined;
  return {
    id: r.id,
    email: r.email,
    status: r.status,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    ...(r.external_ref ? { ref: r.external_ref } : {}),
    ...(entitlements ? { entitlements } : {}),
    ...(suspension ? { suspension } : {}),
  };
};
/** The address a hosted rider has: it cannot receive mail, and it is made from the reference so it is the same each time. */
const hostedEmail = (ref: string): string => `hosted-${hash(ref).slice(0, 24)}@hosted.invalid`;

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
      -- Chat connections (ADR 0056): the clients ChatGPT and Claude register, the one-time codes a rider reads in the app,
      -- the authorization codes and the tokens of a connection. Only hashes are kept.
      CREATE TABLE IF NOT EXISTS oauth_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS link_codes (
        code_hash TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        challenge TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        access_hash TEXT PRIMARY KEY,
        refresh_hash TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        access_expires_at TEXT NOT NULL,
        refresh_expires_at TEXT NOT NULL,
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
    // Columns added for the provisioning API (ADR 0057): a registry made before has none.
    const columns = (this.#db.prepare("PRAGMA table_info(tenants)").all() as unknown as Array<{ name: string }>).map(
      (c) => c.name,
    );
    if (!columns.includes("external_ref")) this.#db.exec("ALTER TABLE tenants ADD COLUMN external_ref TEXT");
    if (!columns.includes("entitlements")) this.#db.exec("ALTER TABLE tenants ADD COLUMN entitlements TEXT");
    if (!columns.includes("suspension")) this.#db.exec("ALTER TABLE tenants ADD COLUMN suspension TEXT");
    this.#db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS tenants_external_ref ON tenants(external_ref) WHERE external_ref IS NOT NULL",
    );
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
    const tenant = this.verifyAny(token);
    return tenant && tenant.status === "active" ? tenant : null;
  }

  /** Who a token identifies, suspended or not: only for what a suspended rider may still ask, which is why they are shut out. */
  verifyAny(token: string): Tenant | null {
    if (!token.startsWith(TOKEN_PREFIX) || token.length < 20 || token.length > 100) return null;
    const h = hash(token);
    const row = this.#db
      .prepare(
        `SELECT * FROM tenants WHERE token_hash = ?1
         OR id = (SELECT tenant_id FROM device_tokens WHERE token_hash = ?1)`,
      )
      .get(h) as unknown as Row | undefined;
    // The hash is looked up, never the token compared; the check below is for the status alone.
    if (!row) return null;
    const now = Date.now();
    if (now - (this.#seen.get(row.id) ?? 0) >= SEEN_EVERY_MS) {
      this.#seen.set(row.id, now);
      this.#db.prepare("UPDATE tenants SET last_seen_at = ? WHERE id = ?").run(new Date(now).toISOString(), row.id);
    }
    return tenantOf(row);
  }

  setStatus(idOrEmail: string, status: TenantStatus, suspension?: { reason: string; until?: string | null }): Tenant {
    const tenant = this.need(idOrEmail);
    const kept =
      status === "suspended" && suspension ? { reason: suspension.reason, until: suspension.until ?? null } : null;
    this.#db
      .prepare("UPDATE tenants SET status = ?, suspension = ? WHERE id = ?")
      .run(status, kept ? JSON.stringify(kept) : null, tenant.id);
    const { suspension: _before, ...rest } = tenant;
    return { ...rest, status, ...(kept ? { suspension: kept } : {}) };
  }

  /** A new token; the old one stops working at once. */
  rekey(idOrEmail: string): { tenant: Tenant; token: string } {
    const tenant = this.need(idOrEmail);
    const token = newToken();
    this.#db.prepare("UPDATE tenants SET token_hash = ? WHERE id = ?").run(hash(token), tenant.id);
    // A leaked token could have made a connection: a new token ends those too.
    this.revokeConnections(tenant.id);
    return { tenant, token };
  }

  /** Forget a tenant: its token stops working. What happens to its library is the caller's to do (`removeLibrary`). */
  remove(idOrEmail: string): Tenant {
    const tenant = this.need(idOrEmail);
    this.#db.prepare("DELETE FROM tenants WHERE id = ?").run(tenant.id);
    this.#db.prepare("DELETE FROM device_tokens WHERE tenant_id = ?").run(tenant.id);
    this.#db.prepare("DELETE FROM invites WHERE tenant_id = ?").run(tenant.id);
    for (const table of ["link_codes", "oauth_codes", "oauth_tokens"])
      this.#db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenant.id);
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
    const made = this.#makeInvite(tenant, hours * 3_600_000, options.pin ?? false, options.now ?? Date.now());
    return { tenant, ...made, created: !known };
  }

  /** An invitation of a few minutes for a hosted rider's phone (no PIN: it is handed straight to the app). */
  inviteTenant(id: string, minutes = 15, now = Date.now()): { tenant: Tenant; code: string; expiresAt: string } | null {
    if (!(minutes >= 1 && minutes <= 60)) throw new Error("The minutes of an invitation are between 1 and 60.");
    const tenant = this.find(id);
    if (!tenant || tenant.status !== "active") return null;
    const { code, expiresAt } = this.#makeInvite(tenant, minutes * 60_000, false, now);
    return { tenant, code, expiresAt };
  }

  #makeInvite(
    tenant: Tenant,
    lifeMs: number,
    withPin: boolean,
    now: number,
  ): { code: string; pin: string | null; expiresAt: string } {
    const code = newInviteCode();
    const pin = withPin ? String(randomInt(0, 1_000_000)).padStart(6, "0") : null;
    const salt = randomBytes(16).toString("hex");
    const expiresAt = new Date(now + lifeMs).toISOString();
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
    return { code, pin, expiresAt };
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
    // A lost phone could have made a connection: stopping the phones ends those too.
    this.revokeConnections(tenant.id);
    return Number(this.#db.prepare("DELETE FROM device_tokens WHERE tenant_id = ?").run(tenant.id).changes);
  }

  /**
   * A one-time code for a chat connection (ADR 0056): the rider reads it in the app (or the administrator prints it) and types
   * it on the sign-in page of ChatGPT or Claude. It lives ten minutes and works once; a rider holds at most five.
   */
  linkCode(idOrEmail: string, now = Date.now()): { tenant: Tenant; code: string; expiresAt: string } {
    const tenant = this.need(idOrEmail);
    this.#db.prepare("DELETE FROM link_codes WHERE expires_at <= ? OR used_at IS NOT NULL").run(iso(now));
    this.#db
      .prepare(
        `DELETE FROM link_codes WHERE tenant_id = ?1 AND code_hash NOT IN
         (SELECT code_hash FROM link_codes WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 4)`,
      )
      .run(tenant.id);
    const raw = linkCodeOf();
    const expiresAt = iso(now + LINK_CODE_MINUTES * 60_000);
    this.#db
      .prepare("INSERT INTO link_codes (code_hash, tenant_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(hash(raw), tenant.id, expiresAt, iso(now));
    return { tenant, code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
  }

  /** Whose code this is, once: an unknown, expired or used code, and a suspended rider, are nobody. */
  redeemLinkCode(code: string, now = Date.now()): Tenant | null {
    const clean = cleanLinkCode(code);
    if (clean.length !== 8) return null;
    const row = this.#db.prepare("SELECT * FROM link_codes WHERE code_hash = ?").get(hash(clean)) as unknown as
      { tenant_id: string; expires_at: string; used_at: string | null } | undefined;
    if (!row || row.used_at || Date.parse(row.expires_at) <= now) return null;
    const tenant = this.find(row.tenant_id);
    if (!tenant || tenant.status !== "active") return null;
    this.#db.prepare("UPDATE link_codes SET used_at = ? WHERE code_hash = ?").run(iso(now), hash(clean));
    return tenant;
  }

  /**
   * A client that registered itself (RFC 7591): the same set of addresses gives the same client, whatever it calls itself, so
   * registering again and again cannot fill the table. `name` is what the sign-in page shows. Null when there are too many.
   */
  registerClient(name: string, redirectUris: string[], now = Date.now()): { id: string } | null {
    const uris = JSON.stringify([...redirectUris].sort());
    const known = this.#db.prepare("SELECT id FROM oauth_clients WHERE redirect_uris = ?").get(uris) as unknown as
      { id: string } | undefined;
    if (known) return known;
    const count = () =>
      (this.#db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as unknown as { n: number }).n;
    if (count() >= MAX_CLIENTS) {
      // Full: forget the clients that never got a token and are over an hour old (a connection is made in minutes).
      this.#db
        .prepare("DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM oauth_tokens)")
        .run(iso(now - 3_600_000));
      if (count() >= MAX_CLIENTS) return null;
    }
    const id = `mrc_${randomBytes(18).toString("base64url")}`;
    this.#db
      .prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
      .run(id, name, uris, iso(now));
    return { id };
  }

  client(id: string): { id: string; name: string; redirectUris: string[] } | null {
    const row = this.#db.prepare("SELECT * FROM oauth_clients WHERE id = ?").get(id) as unknown as
      { id: string; name: string; redirect_uris: string } | undefined;
    return row ? { id: row.id, name: row.name, redirectUris: JSON.parse(row.redirect_uris) as string[] } : null;
  }

  /** The code that the client exchanges for tokens, bound to its PKCE challenge and its address. */
  issueAuthCode(clientId: string, tenantId: string, redirectUri: string, challenge: string, now = Date.now()): string {
    this.#db.prepare("DELETE FROM oauth_codes WHERE expires_at <= ?").run(iso(now));
    const code = `mrx_${randomBytes(24).toString("base64url")}`;
    this.#db
      .prepare(
        `INSERT INTO oauth_codes (code_hash, client_id, tenant_id, redirect_uri, challenge, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(hash(code), clientId, tenantId, redirectUri, challenge, iso(now + AUTH_CODE_MINUTES * 60_000));
    return code;
  }

  #issueTokens(tenantId: string, clientId: string, now: number) {
    const access = `mro_${randomBytes(32).toString("base64url")}`;
    const refresh = `mrr_${randomBytes(32).toString("base64url")}`;
    this.#db.prepare("DELETE FROM oauth_tokens WHERE refresh_expires_at <= ?").run(iso(now));
    this.#db
      .prepare(
        `INSERT INTO oauth_tokens (access_hash, refresh_hash, tenant_id, client_id, access_expires_at, refresh_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hash(access),
        hash(refresh),
        tenantId,
        clientId,
        iso(now + ACCESS_SECONDS * 1000),
        iso(now + REFRESH_DAYS * 86_400_000),
        iso(now),
      );
    return { access, refresh, expiresIn: ACCESS_SECONDS };
  }

  /**
   * Tokens for an authorization code, once, when the client, the address and the PKCE verifier are those it was made for.
   * A code used twice is a stolen one: the tokens it made are ended too.
   */
  exchangeAuthCode(
    code: string,
    clientId: string,
    redirectUri: string,
    verifier: string,
    now = Date.now(),
  ): { access: string; refresh: string; expiresIn: number } | null {
    if (!code.startsWith("mrx_") || code.length > 100) return null;
    const row = this.#db.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").get(hash(code)) as unknown as
      | {
          client_id: string;
          tenant_id: string;
          redirect_uri: string;
          challenge: string;
          expires_at: string;
          used_at: string | null;
        }
      | undefined;
    if (!row || Date.parse(row.expires_at) <= now) return null;
    if (row.used_at) {
      this.#db
        .prepare("DELETE FROM oauth_tokens WHERE tenant_id = ? AND client_id = ? AND created_at >= ?")
        .run(row.tenant_id, row.client_id, row.used_at);
      return null;
    }
    if (row.client_id !== clientId || row.redirect_uri !== redirectUri) return null;
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return null;
    const expected = Buffer.from(row.challenge);
    const given = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const tenant = this.find(row.tenant_id);
    if (!tenant || tenant.status !== "active") return null;
    this.#db.prepare("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ?").run(iso(now), hash(code));
    return this.#issueTokens(tenant.id, clientId, now);
  }

  /** New tokens for a refresh token; the old pair stops working (rotation). */
  refreshTokens(
    refresh: string,
    clientId: string,
    now = Date.now(),
  ): { access: string; refresh: string; expiresIn: number } | null {
    if (!refresh.startsWith("mrr_") || refresh.length > 100) return null;
    const row = this.#db.prepare("SELECT * FROM oauth_tokens WHERE refresh_hash = ?").get(hash(refresh)) as unknown as
      { tenant_id: string; client_id: string; refresh_expires_at: string } | undefined;
    if (!row || row.client_id !== clientId || Date.parse(row.refresh_expires_at) <= now) return null;
    const tenant = this.find(row.tenant_id);
    if (!tenant || tenant.status !== "active") return null;
    this.#db.prepare("DELETE FROM oauth_tokens WHERE refresh_hash = ?").run(hash(refresh));
    return this.#issueTokens(tenant.id, clientId, now);
  }

  /** Who a chat connection's access token identifies: an active rider, or nobody. */
  verifyOauth(token: string, now = Date.now()): Tenant | null {
    if (!token.startsWith("mro_") || token.length < 20 || token.length > 100) return null;
    const row = this.#db
      .prepare("SELECT tenant_id, access_expires_at FROM oauth_tokens WHERE access_hash = ?")
      .get(hash(token)) as unknown as { tenant_id: string; access_expires_at: string } | undefined;
    if (!row || Date.parse(row.access_expires_at) <= now) return null;
    const tenant = this.find(row.tenant_id);
    return tenant && tenant.status === "active" ? tenant : null;
  }

  /** The chat connections of a rider (ChatGPT, Claude): ended at once. */
  revokeConnections(idOrEmail: string): number {
    const tenant = this.need(idOrEmail);
    this.#db.prepare("DELETE FROM link_codes WHERE tenant_id = ?").run(tenant.id);
    this.#db.prepare("DELETE FROM oauth_codes WHERE tenant_id = ?").run(tenant.id);
    return Number(this.#db.prepare("DELETE FROM oauth_tokens WHERE tenant_id = ?").run(tenant.id).changes);
  }

  /** A rider made by the provisioning API, by reference: found when it exists (nothing changes), made when it does not. */
  provision(ref: string): { tenant: Tenant; created: boolean } {
    const known = this.findByRef(ref);
    if (known) return { tenant: known, created: false };
    const id = newId();
    const createdAt = new Date().toISOString();
    // The rider has no token of their own: only the phone's, made by an invitation, opens their library.
    this.#db
      .prepare(
        "INSERT INTO tenants (id, email, token_hash, status, created_at, external_ref) VALUES (?, ?, ?, 'active', ?, ?)",
      )
      .run(id, hostedEmail(ref), hash(newToken()), createdAt, ref);
    return {
      tenant: { id, email: hostedEmail(ref), status: "active", createdAt, lastSeenAt: null, ref },
      created: true,
    };
  }

  findByRef(ref: string): Tenant | null {
    const row = this.#db.prepare("SELECT * FROM tenants WHERE external_ref = ?").get(ref) as unknown as Row | undefined;
    return row ? tenantOf(row) : null;
  }

  /** Replace what a rider may use; an empty set takes them all away. */
  setEntitlements(id: string, entitlements: Entitlements): Tenant {
    const tenant = this.need(id);
    const empty = Object.keys(entitlements).length === 0;
    this.#db
      .prepare("UPDATE tenants SET entitlements = ? WHERE id = ?")
      .run(empty ? null : JSON.stringify(entitlements), tenant.id);
    const { entitlements: _before, ...rest } = tenant;
    return empty ? rest : { ...rest, entitlements };
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
