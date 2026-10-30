import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePolyline } from "./geometry.ts";
import { haversineKm } from "./tools/geo.ts";

/** Pushed files get ids from here up, so they never meet the numbers of the rider's own library. */
export const PUSHED_ID_BASE = 1_000_000;
/** What one rider may keep on the server, and the largest file (a long ride is about 250 KB). */
export const MAX_PUSHED = 100;
export const MAX_PUSHED_BYTES = 5 * 1024 * 1024;

export interface PushedListing {
  id: number;
  name: string;
  distanceKm: number;
  ridingMinutes: number;
  stamp: string;
}

interface Entry extends PushedListing {
  key: string;
  pushedAt: string;
}
interface Index {
  next: number;
  items: Entry[];
}

export class PushRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The stamp of a file: its content without the time it was made, so the same roadbook pushed twice is one version. */
export function fileStamp(doc: Record<string, unknown>): string {
  const { generatedAt: _generatedAt, ...rest } = doc;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}

/** A rider's pushed roadbook files: the mailbox for a library kept elsewhere. One folder per rider. */
export class PushedRoadbooks {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  #read(): Index {
    const path = join(this.#dir, "index.json");
    if (!existsSync(path)) return { next: PUSHED_ID_BASE, items: [] };
    return JSON.parse(readFileSync(path, "utf8")) as Index;
  }

  #write(index: Index): void {
    mkdirSync(this.#dir, { recursive: true });
    const path = join(this.#dir, "index.json");
    writeFileSync(`${path}.tmp`, JSON.stringify(index));
    renameSync(`${path}.tmp`, path);
  }

  list(): PushedListing[] {
    return this.#read().items.map(({ id, name, distanceKm, ridingMinutes, stamp }) => ({
      id,
      name,
      distanceKm,
      ridingMinutes,
      stamp,
    }));
  }

  /** The stored file and its stamp, or null. */
  get(id: number): { stamp: string; body: string } | null {
    const entry = this.#read().items.find((i) => i.id === id);
    if (!entry) return null;
    const path = join(this.#dir, `${id}.json`);
    return existsSync(path) ? { stamp: entry.stamp, body: readFileSync(path, "utf8") } : null;
  }

  /**
   * Keep a roadbook file. One that says which roadbook of which library it is (origin: number and name) replaces the
   * earlier push of the same; otherwise the name is the key. Throws PushRefused for a file that is not a roadbook file.
   */
  put(doc: unknown, now: Date = new Date()): { id: number; stamp: string; replaced: boolean } {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      throw new PushRefused(400, "Not a roadbook file.");
    const file = doc as Record<string, unknown>;
    if (file["format"] !== "motoride-roadbook") throw new PushRefused(400, "Not a motoride-roadbook file.");
    if (file["version"] !== 1) throw new PushRefused(400, "Only version 1 of the roadbook file is known.");
    const name = file["name"];
    if (typeof name !== "string" || !name.trim() || name.length > 200)
      throw new PushRefused(400, "The roadbook file needs a name.");
    const line = typeof file["line"] === "string" ? decodePolyline(file["line"]) : [];
    if (line.length < 2) throw new PushRefused(400, "The roadbook file needs a line of at least two points.");
    const origin = file["origin"] as { app?: unknown; roadbook?: unknown; name?: unknown } | undefined;
    const key =
      origin && typeof origin === "object" && Number.isInteger(origin.roadbook) && typeof origin.name === "string"
        ? `${String(origin.app)}:${String(origin.roadbook)}:${origin.name}`
        : `name:${name}`;
    const stamp = fileStamp(file);
    let distanceKm = 0;
    for (let i = 1; i < line.length; i++) distanceKm += haversineKm(line[i - 1]!, line[i]!);
    const minutes = /about (\d+)h(\d{2})/.exec(typeof file["description"] === "string" ? file["description"] : "");
    const entry = {
      key,
      name,
      distanceKm: Math.round(distanceKm * 10) / 10,
      ridingMinutes: minutes ? Number(minutes[1]) * 60 + Number(minutes[2]) : 0,
      stamp,
      pushedAt: now.toISOString(),
    };

    const index = this.#read();
    const at = index.items.findIndex((i) => i.key === key);
    if (at < 0 && index.items.length >= MAX_PUSHED)
      throw new PushRefused(409, `This server keeps at most ${MAX_PUSHED} pushed roadbooks; remove one first.`);
    const id = at >= 0 ? index.items[at]!.id : index.next++;
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(join(this.#dir, `${id}.json`), JSON.stringify(file));
    if (at >= 0) index.items[at] = { id, ...entry };
    else index.items.push({ id, ...entry });
    this.#write(index);
    return { id, stamp, replaced: at >= 0 };
  }
}
