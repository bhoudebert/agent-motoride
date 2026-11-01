import { z } from "zod";

/**
 * What a hosted rider may use (ADR 0057, spec hosted-provisioning). The program that sells the plans decides what a plan is; the
 * server only enforces these generic limits. A rider with none set has what a self-hosted rider has: whatever the host configured.
 */
export const TRAFFIC_MODES = ["off", "open", "tomtom"] as const;
export type TrafficMode = (typeof TRAFFIC_MODES)[number];

export const entitlementsSchema = z
  .object({
    /** `off`: no traffic anywhere; `open`: the phone's traffic from open data only; `tomtom`: the host's TomTom, up to `trafficPerDay`. */
    traffic: z.enum(TRAFFIC_MODES).optional(),
    /** TomTom requests a day (a point of the phone's traffic is one, a call of the getTraffic tool is one). */
    trafficPerDay: z.number().int().min(0).max(100_000).optional(),
    /** The size the library may reach through uploads, MiB. */
    libraryMb: z.number().int().min(1).max(100_000).optional(),
    /** Requests a minute, instead of the server's default. */
    requestsPerMinute: z.number().int().min(10).max(6000).optional(),
  })
  .strict();
export type Entitlements = z.infer<typeof entitlementsSchema>;

/** The entitlements in a body, or why they are not valid. */
export function parseEntitlements(value: unknown): { ok: true; value: Entitlements } | { ok: false; error: string } {
  const parsed = entitlementsSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `${issue?.path.join(".") || "entitlements"}: ${issue?.message ?? "not valid"}` };
}

/** The reference of a hosted rider: chosen by the program that sells the subscription, opaque here. */
export const REF = /^[A-Za-z0-9._:-]{8,128}$/;
