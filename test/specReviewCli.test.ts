import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { main, summaryText } from "../scripts/spec-review/cli.ts";
import { BadAnswer, ollama, Unavailable } from "../scripts/spec-review/provider.ts";
import { FINDINGS_SCHEMA } from "../scripts/spec-review/schema.ts";
import { buildRepo } from "../evals/spec-review/repo.ts";
import { BASE, SCENARIOS } from "../evals/spec-review/scenarios.ts";

const head = (id: string) => SCENARIOS.find((s) => s.id === id)!;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
}

/** An Ollama on a free port that answers with `reply(request)`. */
async function fakeOllama(reply: (body: any, url: string) => { status?: number; body: unknown }) {
  const requests: any[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push(body);
      const answer = reply(body, req.url ?? "");
      res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
      res.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { host, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

const content = (answer: unknown) => ({ body: { message: { role: "assistant", content: JSON.stringify(answer) } } });

test("spec review CLI: the Ollama adapter asks for JSON that follows the schema, with a context window, at temperature 0", async () => {
  const server = await fakeOllama(() => content({ findings: [] }));
  try {
    const provider = ollama({ host: `${server.host}/`, model: "qwen3:8b", numCtx: 8192 });
    const answer = await provider.complete({ system: "S", user: "U", schema: FINDINGS_SCHEMA });
    assert.deepEqual(JSON.parse(answer), { findings: [] });
    const request = server.requests[0];
    assert.equal(request.model, "qwen3:8b");
    assert.equal(request.stream, false);
    assert.equal(request.think, false, "a thinking model is not left to reason until the window is full");
    assert.deepEqual(request.format, JSON.parse(JSON.stringify(FINDINGS_SCHEMA)));
    assert.deepEqual(request.options, { temperature: 0, num_ctx: 8192 });
    assert.deepEqual(
      request.messages.map((m: any) => [m.role, m.content]),
      [
        ["system", "S"],
        ["user", "U"],
      ],
    );
  } finally {
    await server.close();
  }
});

test("spec review CLI: the adapter tells an absent server or model from an unusable answer", async () => {
  const noModel = await fakeOllama(() => ({ status: 404, body: { error: "model not found" } }));
  const broken = await fakeOllama(() => ({ body: "<html>" }));
  const empty = await fakeOllama(() => ({ body: {} }));
  const busy = await fakeOllama(() => ({ status: 503, body: {} }));
  try {
    const ask = (host: string) => ollama({ host, model: "m" }).complete({ system: "", user: "", schema: {} });
    await assert.rejects(
      ask(noModel.host),
      (e) => e instanceof Unavailable && /ollama pull m/.test((e as Error).message),
    );
    await assert.rejects(ask(broken.host), BadAnswer);
    await assert.rejects(ask(empty.host), BadAnswer);
    await assert.rejects(ask(busy.host), (e) => e instanceof Unavailable && /503/.test((e as Error).message));
    await assert.rejects(
      ask("http://127.0.0.1:1"),
      (e) => e instanceof Unavailable && /not reachable/.test((e as Error).message),
    );
    await assert.rejects(
      ollama({ host: "http://10.255.255.1", model: "m", timeoutMs: 50 }).complete({ system: "", user: "", schema: {} }),
      Unavailable,
    );
  } finally {
    await Promise.all([noModel.close(), broken.close(), empty.close(), busy.close()]);
  }
});

test("spec review CLI: deterministic run writes both reports, exits 1 on an error and changes no spec or code", async () => {
  const repo = buildRepo(BASE, head("behaviour-without-spec").head);
  try {
    const run = capture();
    const code = await main(["--repo", repo.dir, "--base", "main", "--head", "change", "--skip-openspec"], {}, run.io);
    assert.equal(code, 1);
    assert.match(run.out.join("\n"), /code-without-spec src\/tools\/weather.ts/);
    assert.match(run.out.join("\n"), /model review: Not requested/);
    const json = JSON.parse(readFileSync(join(repo.dir, ".spec-review", "report.json"), "utf8"));
    assert.equal(json.blockers.length, 1);
    assert.match(readFileSync(join(repo.dir, ".spec-review", "report.md"), "utf8"), /^# Spec review/);
    // Only the reports were written.
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repo.dir, encoding: "utf8" });
    assert.equal(status.trim(), "?? .spec-review/");
  } finally {
    repo.cleanup();
  }
});

test("spec review CLI: a change with nothing to report exits 0, and the justification is shown", async () => {
  const repo = buildRepo(BASE, head("guide-only").head);
  try {
    const run = capture();
    assert.equal(
      await main(
        ["--repo", repo.dir, "--base", "main", "--head", "change", "--skip-openspec", "--out", join(repo.dir, "o")],
        {},
        run.io,
      ),
      0,
    );
    assert.match(run.out.join("\n"), /nothing blocks/);
    assert.ok(existsSync(join(repo.dir, "o", "report.json")));
  } finally {
    repo.cleanup();
  }

  const refactor = buildRepo(BASE, head("behaviour-without-spec").head);
  try {
    const run = capture();
    const argv = [
      "--repo",
      refactor.dir,
      "--base",
      "main",
      "--head",
      "change",
      "--skip-openspec",
      "--no-spec",
      "no behaviour change",
    ];
    assert.equal(await main(argv, {}, run.io), 0);
    assert.match(run.out.join("\n"), /no spec change needed \(option\): no behaviour change/);
    const label = capture();
    assert.equal(await main(argv.slice(0, 6), { SPEC_REVIEW_NO_SPEC: "label no-spec" }, label.io), 0);
    assert.match(label.out.join("\n"), /\(label\)/);
  } finally {
    refactor.cleanup();
  }
});

test("spec review CLI: --format github prints annotations and fills the job summary", async () => {
  const repo = buildRepo(BASE, head("behaviour-without-spec").head);
  const summary = join(repo.dir, "summary.md");
  try {
    const run = capture();
    await main(
      ["--repo", repo.dir, "--base", "main", "--head", "change", "--skip-openspec", "--format", "github"],
      { GITHUB_STEP_SUMMARY: summary },
      run.io,
    );
    assert.ok(
      run.out.some((l) => l.startsWith("::error file=src/tools/weather.ts,title=spec-review code-without-spec::")),
    );
    assert.match(readFileSync(summary, "utf8"), /# Spec review/);
  } finally {
    repo.cleanup();
  }
});

test("spec review CLI: with a model, a verified high finding blocks and the report carries its evidence", async () => {
  const scenario = head("threshold-contradiction");
  const server = await fakeOllama(() => content(scenario.scripted));
  const repo = buildRepo(BASE, scenario.head);
  try {
    const run = capture();
    const argv = [
      "--repo",
      repo.dir,
      "--base",
      "main",
      "--head",
      "change",
      "--skip-openspec",
      "--provider",
      "ollama",
      "--model",
      "fake:1b",
    ];
    assert.equal(await main(argv, { OLLAMA_HOST: server.host }, run.io), 1);
    assert.equal(server.requests.length, 1, "one call for the one capability touched");
    assert.match(server.requests[0].messages[1].content, /Capability: weather-daylight/);
    const text = run.out.join("\n");
    assert.match(
      text,
      /model high\/high: Rain warning — openspec\/specs\/weather-daylight\/spec.md:11 vs src\/tools\/weather.ts:1/,
    );
    assert.match(text, /proposed: fix-code/);
    const json = JSON.parse(readFileSync(join(repo.dir, ".spec-review", "report.json"), "utf8"));
    assert.equal(json.review.status.state, "completed");
    assert.equal(json.review.findings[0].code.line, 1);
  } finally {
    await server.close();
    repo.cleanup();
  }
});

test("spec review CLI: a model that is not there does not hide the deterministic result", async () => {
  const repo = buildRepo(BASE, head("behaviour-without-spec").head);
  try {
    const run = capture();
    const argv = [
      "--repo",
      repo.dir,
      "--base",
      "main",
      "--head",
      "change",
      "--skip-openspec",
      "--provider",
      "ollama",
      "--model",
      "m",
    ];
    assert.equal(await main(argv, { OLLAMA_HOST: "http://127.0.0.1:1" }, run.io), 1);
    assert.match(run.out.join("\n"), /NOT RUN, unavailable/);

    const clean = buildRepo(BASE, head("guide-with-code").head);
    try {
      const again = capture();
      const flags = [
        "--repo",
        clean.dir,
        "--base",
        "main",
        "--head",
        "change",
        "--skip-openspec",
        "--provider",
        "ollama",
        "--model",
        "m",
      ];
      // Unavailable: the exit code follows the deterministic findings only (this change has one).
      assert.equal(await main(flags, { OLLAMA_HOST: "http://127.0.0.1:1" }, again.io), 1);
      assert.equal(
        await main(
          [...flags, "--require-review", "--no-spec", "x"],
          { OLLAMA_HOST: "http://127.0.0.1:1" },
          capture().io,
        ),
        1,
      );
    } finally {
      clean.cleanup();
    }
  } finally {
    repo.cleanup();
  }
});

test("spec review CLI: --audit checks the tree at the head, and refuses a model", async () => {
  const repo = buildRepo(BASE, head("guide-only").head);
  try {
    const run = capture();
    assert.equal(await main(["--repo", repo.dir, "--audit", "--skip-openspec"], {}, run.io), 0);
    assert.match(run.out.join("\n"), /spec review, audit of HEAD/);
    assert.match(run.out.join("\n"), /nothing blocks/);
    const refused = capture();
    assert.equal(
      await main(["--repo", repo.dir, "--audit", "--provider", "ollama", "--model", "m"], {}, refused.io),
      2,
    );
    assert.match(refused.err.join("\n"), /--audit does not call a model/);
  } finally {
    repo.cleanup();
  }
});

test("spec review CLI: usage errors and technical errors exit 2", async () => {
  const bad = (argv: string[], env = {}) => main(argv, env, capture().io);
  assert.equal(await bad(["--nope"]), 2);
  assert.equal(await bad(["--provider", "ollama"]), 2);
  assert.equal(await bad(["--provider", "openai"]), 2);
  assert.equal(await bad(["--repo", "/nonexistent-folder-xyz"]), 2);
  const repo = buildRepo(BASE, head("guide-only").head);
  try {
    assert.equal(await bad(["--repo", repo.dir, "--base", "no-such-ref"]), 2);
    assert.equal(await bad(["--repo", repo.dir, "--base", "main", "--head", "no-such-ref"]), 2);
    const help = capture();
    assert.equal(await main(["--help"], {}, help.io), 0);
    assert.match(help.out[0]!, /Usage: npm run spec:review/);
  } finally {
    repo.cleanup();
  }
});

test("spec review CLI: the pre-push hook blocks on evidence, and never on its own failure", async () => {
  const blocked = buildRepo(BASE, head("behaviour-without-spec").head);
  try {
    const run = capture();
    const argv = ["--hook", "--repo", blocked.dir, "--base", "main", "--skip-openspec"];
    assert.equal(await main(argv, {}, run.io), 1);
    assert.match(run.err.join("\n"), /push blocked by the spec review.*--no-verify` skips this hook, not those/s);
    assert.match(run.out.join("\n"), /model review: Not requested/, "no model is configured: the hook says so");

    assert.equal(await main(argv, { SKIP_SPEC_REVIEW: "1" }, capture().io), 0);
    assert.equal(
      await main(["--hook", "--repo", blocked.dir, "--base", "no-such-ref"], {}, capture().io),
      0,
      "a technical failure does not stop a push",
    );

    // Configured but unreachable: the push goes ahead on a clean change, and the output says the review did not run.
    // (A change that touches no capability does not contact the model at all, and says that instead.)
    const clean = buildRepo(BASE, head("conforming").head);
    try {
      const quiet = capture();
      const flags = ["--hook", "--repo", clean.dir, "--base", "main", "--skip-openspec"];
      assert.equal(await main(flags, { SPEC_REVIEW_MODEL: "m", OLLAMA_HOST: "http://127.0.0.1:1" }, quiet.io), 0);
      assert.match(quiet.out.join("\n"), /NOT RUN, unavailable/);
      // Nothing changed: nothing to say.
      const same = capture();
      assert.equal(await main(["--hook", "--repo", clean.dir, "--base", "change", "--head", "change"], {}, same.io), 0);
      assert.deepEqual(same.out, []);
    } finally {
      clean.cleanup();
    }
  } finally {
    blocked.cleanup();
  }
});

test("spec review CLI: the hook asks the model when SPEC_REVIEW_MODEL is set, and a verified high finding stops the push", async () => {
  const scenario = head("threshold-contradiction");
  const server = await fakeOllama(() => content(scenario.scripted));
  const repo = buildRepo(BASE, scenario.head);
  try {
    const run = capture();
    const code = await main(
      ["--hook", "--repo", repo.dir, "--base", "main", "--skip-openspec"],
      { SPEC_REVIEW_MODEL: "m", OLLAMA_HOST: server.host },
      run.io,
    );
    assert.equal(code, 1);
    assert.match(run.err.join("\n"), /push blocked/);
  } finally {
    await server.close();
    repo.cleanup();
  }
});

test("spec review CLI: the summary is short and says what ran", () => {
  const report = {
    base: "a",
    head: "b",
    changed: [],
    touched: [],
    unmapped: [],
    noSpec: null,
    skippedChecks: ["openspec validate: openspec is not installed"],
    findings: [],
    review: {
      status: { state: "unavailable" as const, reason: "down" },
      reviewed: [],
      skipped: [],
      findings: [],
      rejected: [{ requirement: "R", reason: "x" }],
    },
    blockers: [],
  };
  const text = summaryText(report);
  assert.match(text, /skipped: openspec validate/);
  assert.match(text, /NOT RUN, unavailable: down/);
  assert.match(text, /1 model finding\(s\) dropped/);
  assert.match(text, /nothing blocks/);
  assert.match(text, /nothing to compare: no file differs.*commit your work on a branch/);
});
