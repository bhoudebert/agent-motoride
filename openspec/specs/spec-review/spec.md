# Spec Review Specification

## Purpose

Catch drift between the specs, the decision records, the code and the tests when a change is made, with checks that
need no model, and an optional review by a model that runs on the developer's machine. The review reports; it never
changes a spec or a file.

## Requirements

### Requirement: Review a change against a base

`npm run spec:review -- --base <ref> --head <ref>` SHALL compute the files changed between the two refs (added, modified,
deleted and renamed), find the capabilities they touch, run the deterministic checks, run the model review only when
asked, and write a JSON report and a Markdown report. The command SHALL exit non-zero when a blocking finding exists,
and zero otherwise, whatever the state of the model review.

#### Scenario: A change with nothing to report

- **WHEN** a change touches only files that no check covers
- **THEN** the command reports no finding, writes both reports and exits 0

#### Scenario: A renamed file

- **WHEN** a file under `src/` is renamed
- **THEN** the report lists it as renamed, with its old and new path, and the checks treat the new path as changed

### Requirement: Capabilities touched by a change

The capabilities a change touches SHALL come from the changed spec files, from the open proposals it edits, and from
`openspec/code-map.json`, which maps code and test files to capabilities. A changed source file the map does not know
SHALL be reported as unmapped, a warning that never blocks.

#### Scenario: A mapped source file

- **WHEN** `src/tools/weather.ts` changes and the map lists it under `weather-daylight`
- **THEN** the report names `weather-daylight` as touched, with the reason

#### Scenario: A file the map does not know

- **WHEN** a new file under `src/` is in no entry of the map
- **THEN** the report warns that it is unmapped, and the spec check falls back to any change under `openspec/specs/` or `openspec/changes/`

### Requirement: Code changes come with a spec change

A change to `src/` SHALL be reported as an error unless one of these holds: a spec of a touched capability changed
(`openspec/specs/<capability>/spec.md`), a delta spec of that capability changed in an open proposal, a file of an open
proposal that names the capability changed (its tasks, for instance), or the change is justified as having no
behaviour change. A change under `docs/` SHALL NOT count as a spec change. The justification SHALL be the `no-spec` label
on the pull request, a `No-Spec: <reason>` line in a commit message of the change, or the `--no-spec <reason>` option,
and the report SHALL show it.

A spec edit that changes only whitespace or blank lines SHALL NOT count as a spec change. In the pull-request check only the
label SHALL count as the justification, because a commit line is written by whoever writes the commit; a commit line SHALL
count in the local review and the hook, and the option `--ignore-commit-lines` SHALL turn that off.

When a change is justified as having no behaviour change, the report SHALL warn, per source file it covers, when the change
adds test cases (a refactor leaves the tests as they are) or changes numbers or strings in the code (a threshold, a message).
These are warnings: a bug fix with a regression test is a legitimate case.

#### Scenario: Behaviour changed, spec untouched

- **WHEN** a change edits `src/tools/weather.ts` and no spec or proposal
- **THEN** the report has an error naming the file and the capability `weather-daylight`, and the command exits non-zero

#### Scenario: Only the guide changed beside the code

- **WHEN** a change edits `src/tools/weather.ts` and a page under `docs/guide/`, and no spec
- **THEN** the error stays, because the guide is not a spec

#### Scenario: A multi-pull-request proposal

- **WHEN** a change edits `src/tools/weather.ts` and ticks a task of an open proposal whose delta spec is for `weather-daylight`
- **THEN** there is no error

#### Scenario: A spec touched only for show

- **WHEN** a change edits `src/tools/weather.ts` and a spec of its capability by adding a trailing space
- **THEN** the error stays

#### Scenario: A commit line in the pull-request check

- **WHEN** the check runs with `--ignore-commit-lines` and the only justification is a `No-Spec:` line in a commit
- **THEN** the error stays; the label would have cleared it

#### Scenario: A refactor that adds a test and changes a number

- **WHEN** a change justified as `No-Spec` adds a test case and changes `40` to `60` in a source file
- **THEN** the report has a warning for the file naming the new test and the changed number, and no error

#### Scenario: A refactor

- **WHEN** a change edits `src/tools/weather.ts` and a commit says `No-Spec: rename an internal helper`
- **THEN** there is no error, and the report shows the reason

### Requirement: Audit the repository as it is

`npm run spec:review -- --audit` SHALL check the whole tree at `--head` (default `HEAD`) with no base, to clean up what
earlier changes left. It SHALL run the validation of the specs, the reference checks on every document under `openspec/`
and `docs/` and not only the files a change touches, and the code map checks: a source file in no entry, a pattern that
matches no file, a capability that has no spec, a spec that no entry covers. It SHALL NOT report code without a spec
change, which is a property of a change. It SHALL NOT call a model, and SHALL refuse `--provider` with `--audit`.

#### Scenario: A stale reference nobody touched

- **WHEN** a document that no recent change touches cites a record that does not exist, and the audit runs
- **THEN** the report has an error at that line

#### Scenario: A source file the map does not know

- **WHEN** a file under `src/` is in no entry of the code map
- **THEN** the audit reports it as unmapped, a warning

### Requirement: Specs and references are valid

The check SHALL run `openspec validate --all --no-interactive` when the tool is installed, and report its failure as an
error and its absence as a skipped check, never as a pass. In the files a change touches under `openspec/`, `docs/adr/`
and `docs/`, it SHALL report as an error a decision record cited as `ADR NNNN` that does not exist, and a path to a
spec or a proposal that does not exist.

#### Scenario: A record that does not exist

- **WHEN** a changed spec cites a record by a number that has no file in `docs/adr/`
- **THEN** the report has an error at that line

#### Scenario: openspec is not installed

- **WHEN** the tool is missing
- **THEN** the report marks the validation as skipped, and says so in both reports

### Requirement: An optional review by a local model

With `--provider ollama`, the command SHALL send each touched capability's requirements and scenarios, the decision
records they cite, the diff of the changed files and the titles of the tests that cover them to the Ollama server named
by `OLLAMA_HOST` (default `http://127.0.0.1:11434`), with the model named by `--model` or `SPEC_REVIEW_MODEL`, and ask
for findings as JSON that follows a schema. The context SHALL be bounded and organised by capability, never the whole
repository. The text sent SHALL be marked as data, never as instructions. The provider is local: no API key, no paid
service.

When the change is justified as having no behaviour change, the question to the model SHALL carry that claim and the
reason, and ask whether the diff changes behaviour.

#### Scenario: A threshold changed

- **WHEN** a change raises a limit in `src/tools/weather.ts` that a requirement of `weather-daylight` states as another value
- **THEN** the model is asked about that requirement with the diff, and may answer with a finding that cites both

### Requirement: Findings are verified before they are shown

Each finding SHALL carry the requirement or record it relies on, the file, line and quote of the spec, the file, line
and quote of the code, the contradiction, a confidence (`high`, `medium`, `low`), a severity and an action (`fix-code`,
`revise-spec`, `decide`). The program SHALL keep a finding only when both files exist, each quote is found in its
file, and the requirement or record exists; it SHALL set the line from where the quote is found. Other findings SHALL be
dropped and counted as rejected, with the reason, in the reports.

#### Scenario: A quote the model invented

- **WHEN** a finding quotes a line that is not in the cited file
- **THEN** it is not published as a finding; the report counts one rejected finding and says why

### Requirement: The state of the model review is never hidden

The reports SHALL say whether the model review was not requested, had nothing to review (no capability touched, so the
model was not contacted), unavailable (the server does not answer, or the model
is not installed), failed (an answer that is not valid JSON or does not follow the schema), or completed. An
unavailable or failed review SHALL NOT be shown as a review that found nothing.

#### Scenario: Ollama is not running

- **WHEN** the review is requested and the connection is refused
- **THEN** the deterministic findings are still reported, the review is marked unavailable, and the exit code depends on the deterministic findings only

#### Scenario: The answer is not JSON

- **WHEN** the model answers with text that does not parse
- **THEN** the review is marked failed with the reason, and no finding comes from it

### Requirement: What blocks

A deterministic error SHALL block. A verified finding of the model SHALL block only when its severity is `high` and its
confidence is `medium` or `high`; every other finding SHALL be advice. The `pre-push` hook SHALL run the deterministic
checks, SHALL add the model review when `SPEC_REVIEW_MODEL` is set and the server answers, SHALL block the push on a
blocking finding, and SHALL NOT block on a review that is unavailable or failed, but SHALL print that it did not run.
The pull-request check SHALL run the deterministic checks only, with no model and no secret.

#### Scenario: A high finding with evidence

- **WHEN** the local review returns a verified `high` finding with confidence `high`
- **THEN** the push is refused, with the finding, its evidence and the action proposed

#### Scenario: The hook cannot reach the model

- **WHEN** `SPEC_REVIEW_MODEL` is set and Ollama does not answer
- **THEN** the push goes ahead if the deterministic checks pass, and the output says the review did not run

### Requirement: A completed model review can be shown on the pull request

With `--publish`, after a model review that completed, the command SHALL post a commit status for the reviewed commit
(context `spec-review/local-model`) and create or update one comment of the pull request, found by a marker, with the
Markdown report. The status SHALL be `failure` when a verified finding blocks and `success` otherwise, and say the model
and the number of blocking and advice findings. Nothing SHALL be posted when the review did not complete or had nothing to
review, so that a commit with no status is a commit the model has not reviewed. The commit SHALL be on the remote already;
otherwise the command SHALL say to push first. The status is informational: it is not a required check, a failure to
publish SHALL NOT change what blocks, and the hook SHALL NOT publish. Text of the model that begins a mention SHALL be
defused so that the comment notifies nobody. Anyone with write access can post the same status: it shows that a review
ran, it does not prove it.

#### Scenario: A clean review

- **WHEN** `npm run spec:review -- --provider ollama --model gemma4:12b --publish` completes with no verified finding on a pushed commit
- **THEN** the commit has a `success` status naming the model, and the pull request has one comment with the report

#### Scenario: A second run on a new commit

- **WHEN** the command runs again after another push
- **THEN** the same comment is updated, the new commit gets its own status, and the older commit keeps its own

#### Scenario: The model did not run

- **WHEN** Ollama is not answering and `--publish` is given
- **THEN** nothing is posted, and the output says why

### Requirement: The review changes nothing

The command and the hook SHALL NOT write to a spec, a decision record, the code or the tests. They SHALL write only the
reports, to the folder named by `--out` (default `.spec-review/`, ignored by Git).

#### Scenario: A finding is reported

- **WHEN** a finding proposes `revise-spec`
- **THEN** no spec file differs from before the run

### Requirement: Quality of the model review is measured

The repository SHALL hold labelled change scenarios (a conforming change, a behaviour change without a spec change, a
guide-only change, a threshold that contradicts a requirement, a refactor, a quote that does not exist) and a command to
run them against a real provider and print true positives, false positives and missed findings. The tests SHALL run the
same scenarios with a scripted provider and never call a model.

#### Scenario: Scoring a run

- **WHEN** the scenarios are scored with the findings a provider returned
- **THEN** a finding on a labelled contradiction is a true positive, a finding on a conforming change is a false positive, and a labelled contradiction with no finding is a missed one
