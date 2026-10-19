import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the libraries live: `data/` next to the code, or `RIDE_DATA_DIR` (a Docker volume, for instance). */
export const DATA_DIR = resolve(
  process.env.RIDE_DATA_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "data"),
);

/** The identifier of a tenant: 8 to 40 letters, digits, hyphens or underscores, so it can never make a path out of its folder. */
export const TENANT_ID = /^[A-Za-z0-9_-]{8,40}$/;

export function assertTenantId(id: string): string {
  if (!TENANT_ID.test(id)) throw new Error(`"${id}" is not a tenant identifier (8 to 40 letters, digits, - or _).`);
  return id;
}

/** The folder of a tenant's library (ADR 0027). */
export const tenantDir = (id: string): string => resolve(DATA_DIR, "tenants", assertTenantId(id));

/** The library file of a tenant. */
export const tenantDbPath = (id: string): string => resolve(tenantDir(id), "agentmotoride.db");
