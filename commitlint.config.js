export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Product names (Biome, GitHub, Codex) start subjects legitimately.
    "subject-case": [0],
  },
};
