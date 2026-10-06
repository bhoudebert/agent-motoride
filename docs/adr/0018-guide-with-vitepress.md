# 0018. A rider's guide built with VitePress from Markdown in the repository

- Status: accepted
- Date: 2026-10-06

## Context

The README had grown into a manual of more than a thousand lines, mixing the
pitch, how to use every feature in two modes, and engineering notes. Two
audiences read the project: riders, through the site, and developers, through
the repository. Usage has to be written once, kept next to the code that it
describes, and pleasant to read for riders.

## Decision

The guide is Markdown in `docs/guide/`, one page per task, each showing the
terminal and the Claude Code or Codex way side by side (VitePress code
groups). VitePress builds it in the Pages workflow into the site at
`/guide/`, themed with the site's roadbook palette and fonts; the same files
read as plain Markdown on GitHub. CI builds it on every pull request, which
fails on a dead internal link. The README keeps the pitch, the quickstart and
links.

## Consequences

One copy of the usage text, changed in the same pull request as the code. A
development dependency (VitePress, with esbuild and Rollup binaries) and a
build step in the Pages workflow; the app itself still has no build. Code
panels are dark in both colour modes, so code is highlighted with a dark theme
only.

## Alternatives considered

Links from the site to the Markdown on GitHub: no tooling, but no search, no
tabs and GitHub's interface for riders. Starlight: heavier, MDX. MkDocs
Material: a Python toolchain next to a Node project.
