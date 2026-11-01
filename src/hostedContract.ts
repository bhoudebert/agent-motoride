import { z } from "zod";
import { entitlementsSchema, REF } from "./entitlements.ts";

/**
 * The calls and answers of the provisioning API and of `GET /me` (ADR 0057, spec hosted-provisioning), written once as schemas:
 * the server checks what it sends against them, and `docs/hosted-provisioning.openapi.json` is generated from them, so the
 * program that calls the API tests against a description that cannot drift from the code.
 */
export const riderSchema = z
  .object({
    ref: z.string().describe("The reference the caller chose for this rider."),
    id: z.string().describe("The server's identifier of the rider."),
    status: z.enum(["active", "suspended"]),
    entitlements: entitlementsSchema.describe("What the rider may use; empty when the host's defaults apply."),
    libraryBytes: z.number().int().min(0),
    createdAt: z.string(),
    lastSeenAt: z.string().nullable(),
    devices: z.number().int().min(0).describe("Phones enrolled now (each redeemed invitation made one token)."),
    enrolledAt: z.string().nullable().describe("When the first phone still enrolled was; null when none is."),
  })
  .strict();

export const createBodySchema = z.object({ entitlements: entitlementsSchema.optional() }).strict();
export const suspendBodySchema = z
  .object({
    reason: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/)
      .optional()
      .describe("A word the app can translate, such as `lapsed`; `lapsed` when none is given."),
    until: z.iso.datetime().optional().describe("When the pause ends or the library is deleted, if the caller says."),
  })
  .strict();
export const invitationBodySchema = z.object({ minutes: z.number().int().min(1).max(60).optional() }).strict();

export const invitationSchema = z
  .object({
    code: z.string().describe("The one-time code the phone exchanges at /enrol."),
    link: z.string().describe("mobilemotoride://server?url=…&code=…, for the app to open."),
    expiresAt: z.string(),
  })
  .strict();

export const revokedSchema = z.object({ ref: z.string(), revoked: z.number().int().min(0) }).strict();
export const deletedSchema = z.object({ ref: z.string(), deleted: z.literal(true) }).strict();
export const errorSchema = z.object({ error: z.string(), detail: z.string().optional() }).strict();

export const meSchema = z
  .object({
    hosted: z.boolean().describe("Whether the rider was made by the provisioning API."),
    riderRef: z
      .string()
      .regex(/^rr-[0-9a-f]{16}$/)
      .describe(
        "A stable opaque reference to the rider, the same on every phone of the rider; a short prefix of the internal identifier, not the whole of it.",
      ),
    suspended: z
      .object({ reason: z.string(), until: z.string().nullable() })
      .strict()
      .optional()
      .describe(
        "Present when the rider is paused: the answer is still 200, so the app can say so instead of 'bad token'.",
      ),
    traffic: z
      .object({
        mode: z.enum(["off", "open", "tomtom", "host"]).describe("`host`: whatever the host configured."),
        perDay: z.number().int().nullable().describe("The day's allowance of TomTom requests, when there is one."),
        usedToday: z.number().int().min(0),
        provider: z
          .enum(["open", "tomtom"])
          .optional()
          .describe(
            "The source that answers this rider's traffic, also when `mode` is `host`; absent when there is none.",
          ),
      })
      .strict(),
    library: z.object({ limitMb: z.number().int().nullable(), usedBytes: z.number().int().min(0) }).strict(),
    requestsPerMinute: z.number().int(),
  })
  .strict();

const schema = (s: z.ZodType): Record<string, unknown> => {
  const { $schema: _ignored, ...json } = z.toJSONSchema(s) as Record<string, unknown>;
  return json;
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ "application/json": { schema: ref(name) } });
const answer = (description: string, name?: string) => ({ description, ...(name ? { content: json(name) } : {}) });
const refParam = {
  name: "ref",
  in: "path",
  required: true,
  schema: { type: "string", pattern: REF.source },
  description: "The reference the caller chose for the rider (URL-encoded).",
};
const secured = [{ adminToken: [] }];
const errors = {
  "401": answer("The admin token is missing or wrong."),
  "404": answer("No rider has this reference.", "Error"),
};

/** The OpenAPI 3.1 description of the provisioning API (port `RIDE_ADMIN_PORT`) and of `GET /me` (the riders' port). */
export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "agentRide provisioning API",
      version: "1.0.0",
      description:
        "ADR 0057. Served on its own private port when RIDE_ADMIN_API is on, never through a public proxy. Every call is repeatable: a webhook delivered twice changes nothing the second time. `GET /me` is served on the riders' port, with a rider's, a phone's or a chat connection's token.",
    },
    components: {
      securitySchemes: {
        adminToken: { type: "http", scheme: "bearer", description: "RIDE_ADMIN_TOKEN, at least 32 characters." },
        riderToken: { type: "http", scheme: "bearer", description: "A rider's, a phone's or a connection's token." },
      },
      schemas: {
        Entitlements: schema(entitlementsSchema),
        Rider: schema(riderSchema),
        CreateBody: schema(createBodySchema),
        InvitationBody: schema(invitationBodySchema),
        SuspendBody: schema(suspendBodySchema),
        Invitation: schema(invitationSchema),
        Deleted: schema(deletedSchema),
        Revoked: schema(revokedSchema),
        Error: schema(errorSchema),
        Me: schema(meSchema),
      },
    },
    paths: {
      "/admin/v1/riders/{ref}": {
        parameters: [refParam],
        put: {
          summary: "Create the rider, or find it; optionally set its entitlements",
          security: secured,
          requestBody: { required: false, content: json("CreateBody") },
          responses: {
            "201": answer("The rider was made.", "Rider"),
            "200": answer("The rider existed.", "Rider"),
            "400": answer("The reference or the body is not valid.", "Error"),
            "401": errors["401"],
          },
        },
        get: {
          summary: "The rider's status, entitlements and library size",
          security: secured,
          responses: { "200": answer("The rider.", "Rider"), ...errors },
        },
        delete: {
          summary: "Delete the rider, their tokens, connections and library, for good",
          security: secured,
          responses: { "200": answer("Deleted.", "Deleted"), ...errors },
        },
      },
      "/admin/v1/riders/{ref}/invitation": {
        parameters: [refParam],
        post: {
          summary: "A one-time invitation for the rider's phone",
          security: secured,
          requestBody: { required: false, content: json("InvitationBody") },
          responses: {
            "200": answer("The invitation.", "Invitation"),
            "409": answer("The rider is suspended.", "Error"),
            ...errors,
          },
        },
      },
      "/admin/v1/riders/{ref}/entitlements": {
        parameters: [refParam],
        put: {
          summary: "Replace what the rider may use",
          security: secured,
          requestBody: { required: true, content: json("Entitlements") },
          responses: {
            "200": answer("The rider, with the new entitlements.", "Rider"),
            "400": answer("An entitlement is unknown or out of range.", "Error"),
            ...errors,
          },
        },
      },
      "/admin/v1/riders/{ref}/suspend": {
        parameters: [refParam],
        post: {
          summary: "Shut the rider out; nothing is lost",
          security: secured,
          requestBody: { required: false, content: json("SuspendBody") },
          responses: {
            "200": answer("The rider.", "Rider"),
            "400": answer("The body is not valid.", "Error"),
            ...errors,
          },
        },
      },
      "/admin/v1/riders/{ref}/devices": {
        parameters: [refParam],
        delete: {
          summary:
            "Stop every phone of the rider and every chat connection, and cancel unused invitations (a lost phone)",
          security: secured,
          responses: { "200": answer("How many phone tokens were ended.", "Revoked"), ...errors },
        },
      },
      "/admin/v1/riders/{ref}/resume": {
        parameters: [refParam],
        post: {
          summary: "Let a suspended rider back in",
          security: secured,
          responses: { "200": answer("The rider.", "Rider"), ...errors },
        },
      },
      "/me": {
        get: {
          summary: "What the rider may use, for the app (on the riders' port)",
          security: [{ riderToken: [] }],
          responses: {
            "200": answer("What the rider may use; `suspended` says when the rider is paused.", "Me"),
            "401": answer("The token is not valid."),
          },
        },
      },
    },
  };
}
