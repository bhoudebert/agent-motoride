// Export a logged planning session as OpenTelemetry traces (OTLP/JSON), with
// the GenAI semantic conventions: one invoke_agent span for the planner and
// one per scout, chat spans for model calls, execute_tool spans for tool calls.
// Built from the runs and trace tables, so any past session can be exported.
import { createHash } from "node:crypto";
import type { SavedRun } from "./store.ts";

export interface TraceEvent {
  id: number;
  at: string;
  scope: string;
  kind: string;
  name: string;
  ms: number | null;
  payload: unknown;
}

type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: AnyValue[] } };
interface Attribute {
  key: string;
  value: AnyValue;
}
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** 1 internal, 3 client. */
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attribute[];
  events: Array<{ timeUnixNano: string; name: string; attributes: Attribute[] }>;
  /** 0 unset, 2 error. */
  status: { code: number; message?: string };
}
export interface OtlpTraces {
  resourceSpans: Array<{
    resource: { attributes: Attribute[] };
    scopeSpans: Array<{ scope: { name: string; version: string }; spans: OtlpSpan[] }>;
  }>;
}

const hex = (text: string, length: number) => createHash("sha256").update(text).digest("hex").slice(0, length);
const nanos = (ms: number) => `${Math.round(ms)}000000`;
const CONTENT_MAX = 8000;

function attr(key: string, value: string | number | boolean | string[] | null | undefined): Attribute[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return [{ key, value: { arrayValue: { values: value.map((v) => ({ stringValue: v })) } } }];
  if (typeof value === "boolean") return [{ key, value: { boolValue: value } }];
  if (typeof value === "number") {
    return [{ key, value: Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value } }];
  }
  return [{ key, value: { stringValue: value.length > CONTENT_MAX ? `${value.slice(0, CONTENT_MAX)}…` : value } }];
}

const json = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

interface ModelPayload {
  stopReason?: string;
  text?: string;
  tokens?: { in: number; cacheWrite: number; cacheRead: number; out: number };
}

/**
 * The session as OTLP/JSON. Ids are derived from the run and event ids, so an
 * export is reproducible. Prompts, answers and tool arguments and results are
 * included only with `content`: they hold the rider's places and routes.
 */
export function runToOtlp(
  run: SavedRun,
  events: TraceEvent[],
  options: { content?: boolean; version?: string } = {},
): OtlpTraces {
  const traceId = hex(`agentmotoride-run-${run.id}-${run.startedAt}`, 32);
  const spanId = (key: string) => hex(`${traceId}:${key}`, 16);
  const content = options.content ?? false;
  const time = (e: TraceEvent) => Date.parse(e.at);
  const runStart = Date.parse(run.startedAt);
  const runEnd = Math.max(runStart + run.usage.seconds * 1000, ...events.map(time));
  const spans: OtlpSpan[] = [];

  const rootId = spanId("root");
  const root: OtlpSpan = {
    traceId,
    spanId: rootId,
    name: "invoke_agent agentMotoride",
    kind: 1,
    startTimeUnixNano: nanos(runStart),
    endTimeUnixNano: nanos(runEnd),
    attributes: [
      ...attr("gen_ai.operation.name", "invoke_agent"),
      ...attr("gen_ai.agent.name", "agentMotoride planner"),
      ...attr("gen_ai.provider.name", "anthropic"),
      ...attr("gen_ai.request.model", run.usage.model),
      ...attr(
        "gen_ai.usage.input_tokens",
        run.usage.inputTokens + run.usage.cacheWriteTokens + run.usage.cacheReadTokens,
      ),
      ...attr("gen_ai.usage.output_tokens", run.usage.outputTokens),
      ...attr("agentmotoride.run.id", run.id),
      ...attr("agentmotoride.run.cost_usd", run.costUsd),
      ...attr("agentmotoride.ride.id", run.rideId),
      ...(content ? attr("agentmotoride.request", run.request) : []),
    ],
    events: [],
    status: run.error ? { code: 2, message: run.error } : { code: 0 },
  };
  spans.push(root);

  // Scouts run inside the planner's scoutAreas call: that tool span is their parent.
  const agentSpans = new Map<string, OtlpSpan>([["main", root]]);
  const agentStart = new Map<string, number>([["main", runStart]]);
  const scopes = [...new Set(events.map((e) => e.scope))].filter((s) => s !== "main");
  for (const scope of scopes) {
    const own = events.filter((e) => e.scope === scope);
    const start = time(own[0]!);
    const container = events.find(
      (e) =>
        e.scope === "main" &&
        e.kind === "tool" &&
        e.name === "scoutAreas" &&
        time(e) - (e.ms ?? 0) <= start &&
        start <= time(e),
    );
    const span: OtlpSpan = {
      traceId,
      spanId: spanId(`agent:${scope}`),
      parentSpanId: container ? spanId(`event:${container.id}`) : rootId,
      name: `invoke_agent ${scope}`,
      kind: 1,
      startTimeUnixNano: nanos(start),
      endTimeUnixNano: nanos(time(own.at(-1)!)),
      attributes: [...attr("gen_ai.operation.name", "invoke_agent"), ...attr("gen_ai.agent.name", scope)],
      events: [],
      status: { code: 0 },
    };
    agentSpans.set(scope, span);
    agentStart.set(scope, start);
    spans.push(span);
  }

  const previous = new Map<string, number>();
  for (const e of events) {
    const agent = agentSpans.get(e.scope)!;
    const end = time(e);
    // A model call starts when the scope's previous step ended.
    const since = previous.get(e.scope) ?? agentStart.get(e.scope)!;
    previous.set(e.scope, end);
    if (e.kind === "model") {
      const p = (e.payload ?? {}) as ModelPayload;
      const t = p.tokens;
      spans.push({
        traceId,
        spanId: spanId(`event:${e.id}`),
        parentSpanId: agent.spanId,
        name: `chat ${e.name}`,
        kind: 3,
        startTimeUnixNano: nanos(Math.min(since, end)),
        endTimeUnixNano: nanos(end),
        attributes: [
          ...attr("gen_ai.operation.name", "chat"),
          ...attr("gen_ai.provider.name", "anthropic"),
          ...attr("gen_ai.response.model", e.name),
          ...attr("gen_ai.response.finish_reasons", p.stopReason ? [p.stopReason] : undefined),
          ...(t
            ? [
                ...attr("gen_ai.usage.input_tokens", t.in + t.cacheWrite + t.cacheRead),
                ...attr("gen_ai.usage.output_tokens", t.out),
                ...attr("gen_ai.usage.cache_read.input_tokens", t.cacheRead),
                ...attr("gen_ai.usage.cache_creation.input_tokens", t.cacheWrite),
              ]
            : []),
          ...(content && p.text ? attr("gen_ai.output.text", p.text) : []),
        ],
        events: [],
        status: { code: 0 },
      });
    } else if (e.kind === "tool") {
      const p = (e.payload ?? {}) as { input?: unknown; output?: unknown; error?: string; repeated?: number };
      const id = spanId(`event:${e.id}`);
      spans.push({
        traceId,
        spanId: id,
        parentSpanId: agent.spanId,
        name: `execute_tool ${e.name}`,
        kind: 1,
        startTimeUnixNano: nanos(end - (e.ms ?? 0)),
        endTimeUnixNano: nanos(end),
        attributes: [
          ...attr("gen_ai.operation.name", "execute_tool"),
          ...attr("gen_ai.tool.name", e.name),
          ...attr("gen_ai.tool.type", "function"),
          ...attr("agentmotoride.tool.repeated", p.repeated),
          ...(content ? attr("gen_ai.tool.call.arguments", json(p.input)) : []),
          ...(content && p.output !== undefined ? attr("gen_ai.tool.call.result", json(p.output)) : []),
        ],
        events: [],
        status: p.error ? { code: 2, message: p.error } : { code: 0 },
      });
    } else {
      // Messages, answers, checks and errors: events on the agent span.
      agent.events.push({
        timeUnixNano: nanos(end),
        name: `${e.kind} ${e.name}`,
        attributes: content ? attr("agentmotoride.payload", json(e.payload)) : [],
      });
      if (e.kind === "error") agent.status = { code: 2, message: json(e.payload).slice(0, 500) };
    }
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [...attr("service.name", "agentMotoride"), ...attr("service.version", options.version ?? "dev")],
        },
        scopeSpans: [{ scope: { name: "agentmotoride", version: options.version ?? "dev" }, spans }],
      },
    ],
  };
}

/**
 * The OTLP/HTTP traces endpoint from the standard variables:
 * OTEL_EXPORTER_OTLP_TRACES_ENDPOINT as is, else OTEL_EXPORTER_OTLP_ENDPOINT plus /v1/traces.
 */
export function otlpEndpoint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) return `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces`;
  return undefined;
}

/** Headers from OTEL_EXPORTER_OTLP_HEADERS ("key=value,key2=value2"), e.g. a backend's API key. */
export function otlpHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at > 0) headers[decodeURIComponent(pair.slice(0, at).trim())] = decodeURIComponent(pair.slice(at + 1).trim());
  }
  return headers;
}

/** Send traces to an OTLP/HTTP collector (JSON encoding). */
export async function sendOtlp(
  traces: OtlpTraces,
  endpoint: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(traces),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `${new URL(endpoint).host} refused the traces: ${response.status} ${(await response.text()).slice(0, 200)}`,
    );
  }
}
