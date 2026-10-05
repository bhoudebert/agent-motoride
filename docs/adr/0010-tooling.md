# 0010. TypeScript 7 native compiler beside the TypeScript 6 API; ESLint and Prettier

- Status: accepted
- Date: 2026-10-05

## Context

TypeScript 7 ships a native compiler without a JavaScript API. typescript-eslint
imports TypeScript through a peer dependency below 6.1. Biome was tried first
and needed a platform-specific binary that failed on some Linux systems.

## Decision

`@typescript/native` (TypeScript 7) runs `tsc` and the typecheck; the
`typescript` package is an alias of `@typescript/typescript6` for tooling, as
the TypeScript 7 announcement recommends. Lint is ESLint with
typescript-eslint; formatting is Prettier. Both are pure JavaScript.

## Consequences

Fast native type checks, working lint, no platform notes. Two TypeScript
packages to keep in step, bumped separately by Dependabot. The alias must not
be "fixed".

## Alternatives considered

TypeScript 5 or 6 only: works, gives up the native compiler. Biome:
single tool, but native binary issues.
