# 0059. A spec reviewer could be an external app

- Status: proposed
- Date: 2026-11-03

## Context

ADR 0058 checks spec drift with deterministic checks in CI and an optional local model. Two gaps remain, and both come from
the same fact: nothing that can judge a change in meaning runs where it cannot be skipped.

- The `no-spec` label says a change has no behaviour change. GitHub lets anyone with write access set any label, so the
  maintainer, a second maintainer, or an agent using the maintainer's token can set it. The label is a visible, auditable
  convention, not a lock.
- The model review runs on one machine, in a hook that `--no-verify` skips. A pull request from a fork never meets it.

A model in CI is not possible for free: GitHub Models was retired on 30 July 2026, a standard runner has no GPU, and a
self-hosted runner on a public repository would run a stranger's code. A check by a person cannot be forged by an agent only
if it is a check no other token can post.

## Decision

Not built. If the project grows to need it, the spec reviewer is **an external GitHub App**, not a workflow:

- A small service receives the `pull_request` webhook of the repository. It reads the pull request through the API (the
  diff and the files, as data) and runs the same `scripts/spec-review.ts` from a trusted checkout of `main`. It never
  runs code from the pull request.
- It uses a model on a host the project controls (Ollama on a machine or a VPS), the model chosen by measuring it with
  `npm run spec:eval`.
- It posts a **check run** with the App's own identity: success, neutral (with the findings as annotations) or failure.
  Branch protection requires that check **from this App** (the required status check can be tied to an App id), so no
  other token, a maintainer's and an agent's included, can post it or satisfy it.
- The `no-spec` label stays, as the author's claim. The App's check says whether the claim holds, instead of a person
  alone deciding it.
- The Git hook stays what it is: a local, skippable convenience.

## Consequences

The claim of "no behaviour change" would be checked by something an agent cannot impersonate, on fork pull requests too.
The cost is real: an App to register and its private key to keep, a service that must be up (a required check from a
service that is down blocks every pull request, so it needs a fallback, such as a maintainer able to bypass), a host with
a model, and a prompt exposed to the text of every pull request. A model reading hostile text can be told to report
nothing, so its verdict can be steered: the check lowers the chance of a wrong merge, it does not replace the person who
merges. None of it exists today, and ADR 0058 chose to add no infrastructure.

When to build it: when the label is used wrongly in practice, or when pull requests from outside need the model's
review and the maintainers cannot run it themselves (`gh pr checkout`, then `npm run spec:review`).

## Alternatives considered

A label set by a bot: a label cannot be limited to one actor. A commit status instead of a check run: any token with write
access can post a status under any name. A workflow on `pull_request_target` that labels or comments: it runs with write
rights on the strength of a pull request from a stranger. A model in a standard runner: no GPU, a model download per run,
slow. A self-hosted runner: unsafe on a public repository. Requiring every contributor to run a local model: cannot be
enforced and excludes contributors without the hardware.
