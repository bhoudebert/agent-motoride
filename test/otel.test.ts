import assert from "node:assert/strict";
import { test } from "node:test";
import { otlpEndpoint, otlpHeaders, runToOtlp, sendOtlp } from "../src/otel.ts";
import { Store } from "../src/store.ts";
import { emptyUsage } from "../src/usage.ts";

function session() {
  const store = new Store(":memory:");
  const usage = {
    ...emptyUsage("claude-sonnet-5-5", "medium"),
    inputTokens: 900,
    cacheReadTokens: 100,
    outputTokens: 50,
    seconds: 4,
  };
  const id = store.startRun({
    home: "Lille",
    request: "Saturday loop",
    usage,
    costUsd: 0.12,
    result: null,
    rideId: null,
    error: null,
  });
  const tokens = { in: 400, cacheWrite: 0, cacheRead: 100, out: 20 };
  const add = (event: Parameters<Store["addTrace"]>[1]) => store.addTrace(id, event);
  add({ scope: "main", kind: "user", name: "message", payload: "Saturday loop from Lille" });
  add({ scope: "main", kind: "model", name: "claude-sonnet-5-5", payload: { stopReason: "tool_use", tokens } });
  add({ scope: "scout:Flandre", kind: "user", name: "brief", payload: "Area to scout: Flandre" });
  add({
    scope: "scout:Flandre",
    kind: "tool",
    name: "calculateTrip",
    ms: 5,
    payload: { input: { waypoints: ["Lille"] }, output: { routeId: "flandre-r1" } },
  });
  add({ scope: "main", kind: "tool", name: "scoutAreas", ms: 60_000, payload: { input: {}, output: { reports: [] } } });
  add({
    scope: "main",
    kind: "tool",
    name: "getWeather",
    ms: 3,
    payload: { input: { location: "Lille" }, error: "open-meteo responded 400" },
  });
  add({ scope: "main", kind: "answer", name: "itinerary", payload: { message: "Loop, 135 km" } });
  return { run: store.findRun(id)!, events: store.listTrace(id) };
}

test("otel: GenAI spans for the planner, scouts, model calls and tools", () => {
  const { run, events } = session();
  const traces = runToOtlp(run, events);
  const spans = traces.resourceSpans[0]!.scopeSpans[0]!.spans;
  const byName = (name: string) => spans.find((s) => s.name === name)!;
  const attr = (span: (typeof spans)[number], key: string) => span.attributes.find((a) => a.key === key)?.value;

  const root = byName("invoke_agent agentMotoride");
  assert.equal(root.parentSpanId, undefined);
  assert.match(root.traceId, /^[0-9a-f]{32}$/);
  assert.match(root.spanId, /^[0-9a-f]{16}$/);
  assert.deepEqual(attr(root, "gen_ai.usage.input_tokens"), { intValue: "1000" });
  assert.deepEqual(attr(root, "agentmotoride.run.cost_usd"), { doubleValue: 0.12 });

  const chat = byName("chat claude-sonnet-5-5");
  assert.equal(chat.parentSpanId, root.spanId);
  assert.equal(chat.kind, 3);
  assert.deepEqual(attr(chat, "gen_ai.usage.input_tokens"), { intValue: "500" });
  assert.deepEqual(attr(chat, "gen_ai.response.finish_reasons"), {
    arrayValue: { values: [{ stringValue: "tool_use" }] },
  });

  // The scout runs inside the planner's scoutAreas call.
  const scouts = byName("execute_tool scoutAreas");
  const scout = byName("invoke_agent scout:Flandre");
  assert.equal(scout.parentSpanId, scouts.spanId);
  assert.equal(byName("execute_tool calculateTrip").parentSpanId, scout.spanId);

  const failed = byName("execute_tool getWeather");
  assert.deepEqual(failed.status, { code: 2, message: "open-meteo responded 400" });
  assert.equal(BigInt(failed.endTimeUnixNano) - BigInt(failed.startTimeUnixNano), 3_000_000n, "3 ms tool span");
  assert.deepEqual(
    root.events.map((e) => e.name),
    ["user message", "answer itinerary"],
  );

  // Reproducible ids: the same run exports the same trace.
  assert.deepEqual(runToOtlp(run, events), traces);
});

test("otel: prompts, answers and tool data only with content", () => {
  const { run, events } = session();
  const without = JSON.stringify(runToOtlp(run, events));
  for (const secret of ["Saturday loop", "Lille", "flandre-r1", "135 km"]) assert.ok(!without.includes(secret), secret);
  const withContent = JSON.stringify(runToOtlp(run, events, { content: true }));
  for (const text of ["gen_ai.tool.call.arguments", "gen_ai.tool.call.result", "Loop, 135 km"]) {
    assert.ok(withContent.includes(text), text);
  }
});

test("otel: standard endpoint and header variables; a refusal is reported", async () => {
  assert.equal(
    otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318/" }),
    "http://localhost:4318/v1/traces",
  );
  assert.equal(
    otlpEndpoint({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://x/traces", OTEL_EXPORTER_OTLP_ENDPOINT: "http://y" }),
    "https://x/traces",
  );
  assert.equal(otlpEndpoint({}), undefined);
  assert.deepEqual(otlpHeaders({ OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=abc%3D, team = ride" }), {
    "x-api-key": "abc=",
    team: "ride",
  });

  const { run, events } = session();
  const previous = globalThis.fetch;
  let sent: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    const bad = url.includes("bad");
    return new Response(bad ? "nope" : "{}", { status: bad ? 401 : 200 });
  }) as typeof fetch;
  try {
    await sendOtlp(runToOtlp(run, events), "http://collector/v1/traces", { "x-api-key": "k" });
    assert.equal((sent!.init.headers as Record<string, string>)["x-api-key"], "k");
    assert.ok(JSON.parse(String(sent!.init.body)).resourceSpans);
    await assert.rejects(sendOtlp(runToOtlp(run, events), "http://bad/v1/traces"), /refused the traces: 401/);
  } finally {
    globalThis.fetch = previous;
  }
});
