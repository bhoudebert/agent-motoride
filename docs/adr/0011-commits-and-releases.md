# 0011. Conventional Commits, squash merges, automated releases

- Status: accepted
- Date: 2026-10-05

## Context

Changes arrive through pull requests from people and coding agents. Versions
and changelogs should follow from the history without manual work.

## Decision

Commit messages and pull request titles follow Conventional Commits with a
fixed type list, enforced by a commit-msg hook, commitlint in CI and a PR title
check. Pull requests are squash-merged, so the title becomes the commit on
`main`. release-please reads `main` and maintains a release pull request with
the version bump and changelog; merging it tags the release. `main` is
protected: pull request and green CI required, linear history, no force push.

## Consequences

Releases cost one merge. A non-conventional title or message is rejected early.
Contributors must learn the convention; `CONTRIBUTING.md` and `AGENTS.md`
document it.

## Alternatives considered

Manual tagging and changelog: forgotten in practice. Merge commits: noisier
history, and release automation reads branch commits inconsistently.
