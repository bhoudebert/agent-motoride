/**
 * The relay of live ride sharing (ADR 0028, spec live-sharing): it passes encrypted updates from a rider's phone to the
 * browsers that follow, and never holds a key or a position in the clear. Channels live in memory.
 */

/** A channel identifier: 16 random bytes as base64url, made by the rider's phone. */
export const CHANNEL = /^[A-Za-z0-9_-]{22}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
/** A 96-bit nonce is 12 bytes, 16 characters. */
const IV_LENGTH = 16;
/** 2 KiB of ciphertext is 2731 characters of base64url. */
export const MAX_CT_CHARS = 2731;

export interface Update {
  seq: number;
  at: number;
  iv: string;
  ct: string;
}

interface Channel {
  tenantId: string;
  createdAt: number;
  lastAt: number;
  lastPublishAt: number;
  state: "live" | "ended";
  endedAt: number | null;
  seq: number;
  items: Update[];
}

export interface LiveOptions {
  now?: () => number;
  /** Open channels a rider may have, and in all (3 and 1000). */
  perTenant?: number;
  total?: number;
  /** Updates a channel keeps (720: six hours at one every 30 seconds). */
  keep?: number;
  /** A channel is removed this long after its last update (12 hours) and, once ended, after this (30 minutes). */
  idleMs?: number;
  endedKeepMs?: number;
  /** The least time between two updates of a channel (2 seconds). */
  minGapMs?: number;
}

export type PublishResult =
  { ok: true; seq: number } | { ok: false; reason: "unknown" | "forbidden" | "too-fast" | "bad" | "ended" };

export class LiveShares {
  readonly #channels = new Map<string, Channel>();
  readonly #now: () => number;
  readonly #perTenant: number;
  readonly #total: number;
  readonly #keep: number;
  readonly #idleMs: number;
  readonly #endedKeepMs: number;
  readonly #minGapMs: number;

  constructor(options: LiveOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#perTenant = options.perTenant ?? 3;
    this.#total = options.total ?? 1000;
    this.#keep = options.keep ?? 720;
    this.#idleMs = options.idleMs ?? 12 * 3_600_000;
    this.#endedKeepMs = options.endedKeepMs ?? 30 * 60_000;
    this.#minGapMs = options.minGapMs ?? 2000;
  }

  get size(): number {
    return this.#channels.size;
  }

  /** Create a channel for a rider, or confirm it for the same rider; another rider's channel is theirs. */
  create(channel: string, tenantId: string): "created" | "same" | "taken" | "limit" | "bad" {
    if (!CHANNEL.test(channel)) return "bad";
    this.sweep();
    const found = this.#channels.get(channel);
    if (found) return found.tenantId === tenantId ? "same" : "taken";
    const mine = [...this.#channels.values()].filter((c) => c.tenantId === tenantId).length;
    if (mine >= this.#perTenant || this.#channels.size >= this.#total) return "limit";
    const now = this.#now();
    this.#channels.set(channel, {
      tenantId,
      createdAt: now,
      lastAt: now,
      lastPublishAt: 0,
      state: "live",
      endedAt: null,
      seq: 0,
      items: [],
    });
    return "created";
  }

  /** Store one encrypted update. The server checks its shape and size, never what is in it. */
  publish(channel: string, tenantId: string, iv: unknown, ct: unknown): PublishResult {
    const c = this.#live(channel);
    if (!c) return { ok: false, reason: "unknown" };
    if (c.tenantId !== tenantId) return { ok: false, reason: "forbidden" };
    if (c.state === "ended") return { ok: false, reason: "ended" };
    if (
      typeof iv !== "string" ||
      typeof ct !== "string" ||
      iv.length !== IV_LENGTH ||
      !B64URL.test(iv) ||
      !B64URL.test(ct) ||
      ct.length > MAX_CT_CHARS ||
      ct.length < 22
    )
      return { ok: false, reason: "bad" };
    const now = this.#now();
    if (now - c.lastPublishAt < this.#minGapMs) return { ok: false, reason: "too-fast" };
    c.lastPublishAt = now;
    c.lastAt = now;
    c.seq += 1;
    c.items.push({ seq: c.seq, at: now, iv, ct });
    if (c.items.length > this.#keep) c.items.splice(0, c.items.length - this.#keep);
    return { ok: true, seq: c.seq };
  }

  /** What a follower asks for: the updates after `after`, and the state of the channel; null when there is none. */
  read(
    channel: string,
    after: number,
  ): { state: "live" | "ended"; updatedAt: number; items: Update[]; next: number } | null {
    const c = this.#live(channel);
    if (!c) return null;
    const items = c.items.filter((u) => u.seq > after);
    return { state: c.state, updatedAt: c.lastAt, items, next: c.seq };
  }

  /** The rider ends the ride (kept a little while for followers) or stops sharing (removed at once). */
  end(channel: string, tenantId: string, mode: "end" | "stop"): "ok" | "unknown" | "forbidden" {
    const c = this.#live(channel);
    if (!c) return "unknown";
    if (c.tenantId !== tenantId) return "forbidden";
    if (mode === "stop") this.#channels.delete(channel);
    else {
      c.state = "ended";
      c.endedAt = this.#now();
    }
    return "ok";
  }

  /** The riders' channels that are still there, for a tenant that is removed or suspended. */
  dropTenant(tenantId: string): number {
    let n = 0;
    for (const [id, c] of this.#channels) {
      if (c.tenantId === tenantId) {
        this.#channels.delete(id);
        n++;
      }
    }
    return n;
  }

  /** Remove the channels that are idle or ended long enough; returns how many. */
  sweep(): number {
    const now = this.#now();
    let n = 0;
    for (const [id, c] of this.#channels) {
      const gone =
        c.state === "ended" ? now - (c.endedAt ?? c.lastAt) >= this.#endedKeepMs : now - c.lastAt >= this.#idleMs;
      if (gone) {
        this.#channels.delete(id);
        n++;
      }
    }
    return n;
  }

  /** A channel that has not expired; an expired one is removed on the way. */
  #live(channel: string): Channel | undefined {
    const c = this.#channels.get(channel);
    if (!c) return undefined;
    const now = this.#now();
    const gone =
      c.state === "ended" ? now - (c.endedAt ?? c.lastAt) >= this.#endedKeepMs : now - c.lastAt >= this.#idleMs;
    if (gone) {
      this.#channels.delete(channel);
      return undefined;
    }
    return c;
  }
}
