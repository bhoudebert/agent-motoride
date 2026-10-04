// Conventional Commits, enforced on commit (hook) and in CI.
// Types drive the version and the changelog through release-please.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "style", "revert"],
    ],
    "scope-case": [2, "always", "kebab-case"],
    // Product names (Biome, GitHub, Codex) start subjects legitimately.
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [2, "always", 120],
  },
};
