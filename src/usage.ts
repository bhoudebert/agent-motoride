import type Anthropic from "@anthropic-ai/sdk";

/** What one planning session consumed, accumulated over all its turns. */
export interface RunUsage {
  model: string;
  /** Reasoning effort, or "n/a" for models that do not take the setting. */
  effort: string;
  /** Messages the rider sent (first request plus refinements). */
  turns: number;
  /** Requests made to the model; each tool round is one. */
  modelCalls: number;
  toolCalls: number;
  /** Input tokens billed at the full rate. */
  inputTokens: number;
  /** Input tokens written to the prompt cache (billed above the full rate). */
  cacheWriteTokens: number;
  /** Input tokens read from the prompt cache (billed far below the full rate). */
  cacheReadTokens: number;
  outputTokens: number;
  /** Wall-clock time spent waiting for the model and its tools. */
  seconds: number;
}

export function emptyUsage(model: string, effort: string): RunUsage {
  return {
    model,
    effort,
    turns: 0,
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    seconds: 0,
  };
}

// USD per million tokens: input, output, cache read, cache write (5-minute cache).
// List prices as of 2026-09; update here when they change.
const PRICES: Array<[prefix: string, input: number, output: number, cacheRead: number, cacheWrite: number]> = [
  ["claude-fable-5", 10, 50, 0.25, 12.5],
  ["claude-opus-5-5", 4, 20, 0.2, 5],
  ["claude-opus-5", 5, 25, 0.5, 6.25],
  ["claude-opus-4", 5, 25, 0.5, 6.25],
  ["claude-sonnet-5", 2, 10, 0.2, 2.5],
  ["claude-sonnet-4", 3, 15, 0.3, 3.75],
  ["claude-haiku-4-5", 1, 5, 0.1, 1.25],
];

/** False for a model id this app has no price for, which usually means a typo. */
export function isKnownModel(model: string): boolean {
  return PRICES.some(([prefix]) => model.startsWith(prefix));
}

/** Estimated cost in USD from list prices, or null for a model not in the table. */
export function estimateCostUsd(usage: RunUsage): number | null {
  const price = PRICES.find(([prefix]) => usage.model.startsWith(prefix));
  if (!price) return null;
  const [, input, output, cacheRead, cacheWrite] = price;
  const usd =
    (usage.inputTokens * input +
      usage.outputTokens * output +
      usage.cacheReadTokens * cacheRead +
      usage.cacheWriteTokens * cacheWrite) /
    1_000_000;
  return Number(usd.toFixed(4));
}

const k = (tokens: number) => (tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens));
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, "0")}`;

export function formatUsage(usage: RunUsage): string {
  const cost = estimateCostUsd(usage);
  return [
    `${usage.model}, effort ${usage.effort}`,
    `${usage.turns} turn${usage.turns === 1 ? "" : "s"}, ${usage.modelCalls} model calls, ${usage.toolCalls} tool calls`,
    `tokens: ${k(usage.inputTokens + usage.cacheWriteTokens)} in, ${k(usage.cacheReadTokens)} from cache, ${k(usage.outputTokens)} out`,
    duration(usage.seconds),
    cost === null ? "cost unknown for this model" : `about $${cost.toFixed(2)}`,
  ].join("  |  ");
}

/** Accumulate one model response into the session's usage counters. */
export function countUsage(usage: RunUsage, message: Anthropic.Beta.BetaMessage): void {
  usage.modelCalls++;
  usage.inputTokens += message.usage.input_tokens;
  usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
  usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
  usage.outputTokens += message.usage.output_tokens;
  for (const block of message.content) if (block.type === "tool_use") usage.toolCalls++;
}

/** What a model response did, for the trace. */
export function describeResponse(message: Anthropic.Beta.BetaMessage) {
  return {
    stopReason: message.stop_reason,
    tools: message.content.flatMap((b) => (b.type === "tool_use" ? [b.name] : [])),
    text: message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .slice(0, 2000),
    tokens: {
      in: message.usage.input_tokens,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      out: message.usage.output_tokens,
    },
  };
}
