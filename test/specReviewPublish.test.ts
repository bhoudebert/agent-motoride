import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../scripts/spec-review/cli.ts";
import { gitSource } from "../scripts/spec-review/git.ts";
import { Unavailable, type Provider } from "../scripts/spec-review/provider.ts";
import {
  COMMENT_MARKER,
  defuse,
  describe,
  publish,
  PublishError,
  STATUS_CONTEXT,
  type Gh,
} from "../scripts/spec-review/publish.ts";
import { runReview } from "../scripts/spec-review/run.ts";
import { buildRepo } from "../evals/spec-review/repo.ts";
import { BASE, SCENARIOS } from "../evals/spec-review/scenarios.ts";
import type { Report } from "../scripts/spec-review/types.ts";

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const scripted = (answer: unknown): Provider => ({
  name: "ollama",
  model: "gemma4:12b",
  complete: async () => JSON.stringify(answer),
});

async function report(id: string, provider: Provider): Promise<Report> {
  const s = scenario(id);
  const repo = buildRepo(BASE, s.head, s.messages);
  try {
    return await runReview(gitSource(repo.dir, repo.base, repo.head), { provider, openspec: false });
  } finally {
    repo.cleanup();
  }
}

/** A `gh` that answers from a script and records every call. */
function fakeGh(answers: { commit?: boolean; pr?: string | null; comments?: string; failStatus?: boolean } = {}) {
  const calls: Array<{ args: string[]; input?: string }> = [];
  const gh: Gh = (args, input) => {
    calls.push({ args, input });
    const path = args.find((a) => a.startsWith("repos/")) ?? "";
    if (args[0] === "pr") {
      if (answers.pr === null) throw new Error("no pull request");
      return `${answers.pr ?? "187"}\n`;
    }
    if (path.includes("/commits/")) {
      if (answers.commit === false) throw new Error("Not Found (HTTP 404)");
      return "abc\n";
    }
    if (path.includes("/statuses/") && answers.failStatus) throw new Error("HTTP 403\nsecond line");
    if (path.endsWith("/comments") && args.includes("--paginate")) return answers.comments ?? "";
    return "{}";
  };
  return { gh, calls };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const posted = (calls: ReturnType<typeof fakeGh>["calls"], what: string) =>
  calls.filter((c) => c.args.some((a) => a.includes(what)));

test("spec review publish: a clean completed review gives a success status and one comment", async () => {
  const { gh, calls } = fakeGh();
  const result = publish(await report("conforming", scripted({ findings: [] })), {
    sha: SHA,
    gh,
    now: new Date("2026-11-03T12:00:00Z"),
  });
  assert.deepEqual(
    { ...result, description: undefined },
    { published: true, sha: SHA, state: "success", description: undefined, pr: 187, comment: "created" },
  );
  const status = posted(calls, "/statuses/")[0]!.args;
  assert.ok(status.includes(`repos/{owner}/{repo}/statuses/${SHA}`));
  assert.ok(status.includes("state=success"));
  assert.ok(status.includes(`context=${STATUS_CONTEXT}`));
  assert.ok(status.some((a) => a.startsWith("description=ollama/gemma4:12b: no blocking finding")));
  const comment = posted(calls, "/issues/187/comments").find((c) => c.args.includes("POST"))!;
  const body = JSON.parse(comment.input!).body as string;
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /commit `0123456`, 2026-11-03T12:00:00.000Z/);
  assert.match(body, /does not prove the review is right/);
  assert.match(body, /# Spec review/);
});

test("spec review publish: a later run updates the same comment", async () => {
  const { gh, calls } = fakeGh({ comments: "4242\n" });
  const result = publish(await report("conforming", scripted({ findings: [] })), { sha: SHA, gh });
  assert.equal(result.published && result.comment, "updated");
  const update = calls.find((c) => c.args.includes("PATCH"))!;
  assert.ok(update.args.includes("repos/{owner}/{repo}/issues/comments/4242"));
  assert.ok(
    !calls.some((c) => c.args.includes("POST") && c.args.some((a) => a.endsWith("/comments"))),
    "no second comment",
  );
});

test("spec review publish: a verified blocking finding is a failure status", async () => {
  const { gh, calls } = fakeGh();
  const r = await report("threshold-contradiction", scripted(scenario("threshold-contradiction").scripted));
  const result = publish(r, { sha: SHA, gh });
  assert.equal(result.published && result.state, "failure");
  assert.ok(
    posted(calls, "/statuses/")[0]!.args.some((a) =>
      a.startsWith("description=ollama/gemma4:12b: 1 blocking finding(s)"),
    ),
  );
});

test("spec review publish: nothing is posted unless the model review completed", async () => {
  for (const provider of [
    { name: "ollama", model: "m", complete: async () => Promise.reject(new Unavailable("down")) } as Provider,
    { name: "ollama", model: "m", complete: async () => "not json" } as Provider,
  ]) {
    const { gh, calls } = fakeGh();
    const result = publish(await report("behaviour-without-spec", provider), { sha: SHA, gh });
    assert.equal(result.published, false);
    assert.deepEqual(calls, [], "no call to GitHub at all");
  }
  const { gh, calls } = fakeGh();
  const idle = publish(await report("guide-only", scripted({ findings: [] })), { sha: SHA, gh });
  assert.deepEqual([idle.published, calls.length], [false, 0]);
  assert.match((idle as { reason: string }).reason, /nothing-to-review/);
});

test("spec review publish: a commit that is not on GitHub is a clear error, and nothing is posted", async () => {
  const { gh, calls } = fakeGh({ commit: false });
  assert.throws(
    () => publish(awaitedReport, { sha: SHA, gh }),
    (e) => e instanceof PublishError && /push it first/.test((e as Error).message),
  );
  assert.equal(posted(calls, "/statuses/").length, 0);
});

test("spec review publish: without a pull request only the status is posted", () => {
  const { gh, calls } = fakeGh({ pr: null });
  const result = publish(awaitedReport, { sha: SHA, gh });
  assert.deepEqual([result.published && result.pr, result.published && result.comment], [null, "none"]);
  assert.equal(posted(calls, "/issues/").length, 0);
  // A pull request given explicitly is not looked up.
  const explicit = fakeGh();
  publish(awaitedReport, { sha: SHA, pr: 9, gh: explicit.gh });
  assert.ok(!explicit.calls.some((c) => c.args[0] === "pr"));
  assert.ok(posted(explicit.calls, "/issues/9/comments").length > 0);
});

test("spec review publish: a failure to post says what and where", () => {
  assert.throws(
    () => publish(awaitedReport, { sha: SHA, gh: fakeGh({ failStatus: true }).gh }),
    (e) => e instanceof PublishError && /status could not be posted: HTTP 403$/.test((e as Error).message),
  );
});

test("spec review publish: a mention in the model's words notifies nobody, an address is left alone", () => {
  assert.equal(defuse("ask @someone, or @team-x\n@first line"), "ask @​someone, or @​team-x\n@​first line");
  assert.equal(defuse("write to a@b.org or `@decorator`"), "write to a@b.org or `@decorator`");
});

test("spec review publish: the description stays within what GitHub accepts", () => {
  const long = {
    ...awaitedReport,
    review: { ...awaitedReport.review, rejected: Array.from({ length: 5 }, () => ({ requirement: "R", reason: "x" })) },
  };
  const { description } = describe(long);
  assert.ok(description.length <= 140);
  assert.match(description, /5 dropped: no evidence/);
});

test("spec review publish CLI: --publish needs a model, refuses --audit, and is ignored by the hook", async () => {
  const repo = buildRepo(BASE, scenario("guide-only").head);
  const run = async (argv: string[], env = {}) => {
    const err: string[] = [];
    const out: string[] = [];
    const code = await main(["--repo", repo.dir, "--base", "main", "--skip-openspec", ...argv], env, {
      out: (t) => out.push(t),
      err: (t) => err.push(t),
    });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  try {
    const noModel = await run(["--publish"]);
    assert.equal(noModel.code, 2);
    assert.match(noModel.err, /--publish shows a model review/);
    assert.equal((await run(["--publish", "--audit", "--provider", "ollama", "--model", "m"])).code, 2);

    const hook = await run(["--hook", "--publish"]);
    assert.equal(hook.code, 0);
    assert.match(hook.err, /--publish is ignored by the hook/);

    // The model is not there: the review is reported, nothing is posted, and publishing is not a failure.
    const down = await run(["--publish", "--provider", "ollama", "--model", "m"], {
      OLLAMA_HOST: "http://127.0.0.1:1",
    });
    assert.equal(down.code, 0);
    assert.match(down.out, /not published: the model review did not complete \(nothing-to-review\)/);
  } finally {
    repo.cleanup();
  }
});

// A completed review with nothing to report, shared by the tests above.
const awaitedReport = await report("conforming", scripted({ findings: [] }));
