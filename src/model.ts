import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const MODEL = process.env.RIDE_MODEL || "claude-opus-5-5";
export const EFFORT = (process.env.RIDE_EFFORT || "high") as Effort;
/** Scouts do narrow, well-specified work: a cheaper model at low effort is enough. */
export const SCOUT_MODEL = process.env.RIDE_SCOUT_MODEL || "claude-sonnet-5-5";
export const SCOUT_EFFORT = (process.env.RIDE_SCOUT_EFFORT || "low") as Effort;

/** Haiku 4.5 predates adaptive thinking and the effort setting. */
export const isLegacyThinking = (model: string) => model.startsWith("claude-haiku");

/**
 * Request settings that depend on the model generation, plus the schema the
 * final answer must follow (structured output, validated by the API).
 */
export function requestSettings(model: string, effort: Effort, schema: z.ZodType) {
  const format = betaZodOutputFormat(schema);
  if (isLegacyThinking(model)) {
    return { thinking: { type: "enabled" as const, budget_tokens: 4000 }, output_config: { format } };
  }
  return {
    thinking: { type: "adaptive" as const },
    output_config: { effort, format },
    // If a safety classifier declines the request, the API re-runs it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}
