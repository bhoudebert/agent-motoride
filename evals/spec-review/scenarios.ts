import type { Files } from "./repo.ts";

/** A small project: one capability, one source file, its test, a record and a guide page. */
const RAIN_SPEC = `# Weather Specification

## Purpose

Tell the rider about the weather.

## Requirements

### Requirement: Rain warning

The system SHALL warn the rider when the chance of rain along the route is above 40 percent.

#### Scenario: A wet afternoon

- **WHEN** the chance of rain is 60 percent
- **THEN** the rider is warned

### Requirement: Wind warning

The system SHALL warn the rider when the crosswind is above 50 km/h, as chosen in ADR 0001.

#### Scenario: A gusty ridge

- **WHEN** the crosswind is 60 km/h
- **THEN** the rider is warned
`;

const WEATHER = `export const RAIN_WARNING_PERCENT = 40;
export const WIND_WARNING_KMH = 50;

export function warnsOfRain(chance: number): boolean {
  return chance > RAIN_WARNING_PERCENT;
}

export function warnsOfWind(kmh: number): boolean {
  return kmh > WIND_WARNING_KMH;
}
`;

export const BASE: Files = {
  "openspec/specs/weather-daylight/spec.md": RAIN_SPEC,
  "openspec/code-map.json": JSON.stringify({
    capabilities: { "weather-daylight": { code: ["src/tools/weather.ts"], tests: ["test/weather.test.ts"] } },
  }),
  "src/tools/weather.ts": WEATHER,
  "test/weather.test.ts": `import { test } from "node:test";\ntest("warns above 40 percent of rain", () => {});\ntest("warns above 50 km/h of wind", () => {});\n`,
  "docs/adr/0001-wind-limit.md": "# 0001. The wind limit\n\n- Status: accepted\n\n## Decision\n\nWarn above 50 km/h.\n",
  "docs/guide/weather.md": "# Weather\n\nThe app warns about rain.\n",
};

export interface Scenario {
  id: string;
  description: string;
  head: Files;
  /** Commit messages of the change, the first one carries the files. */
  messages?: string[];
  expect: {
    /** Rules the deterministic checks must report as errors, exactly. */
    errors: string[];
    /** Requirements a good model reports as contradicted, exactly. */
    contradictions: string[];
    /** Other findings that are true, and that a good model may or may not add: neither a hit nor a false alarm. */
    allowed?: string[];
  };
  /** What a scripted model answers in the tests. A real model is asked the same question. */
  scripted: unknown;
}

const rainQuote = {
  file: "openspec/specs/weather-daylight/spec.md",
  line: 0,
  quote: "warn the rider when the chance of rain along the route is above 40 percent",
};

export const SCENARIOS: Scenario[] = [
  {
    id: "conforming",
    description: "The code, the spec and the record change together, and agree.",
    head: {
      "src/tools/weather.ts": WEATHER.replace("= 50;", "= 45;"),
      "openspec/specs/weather-daylight/spec.md": RAIN_SPEC.replace("above 50 km/h", "above 45 km/h"),
      "docs/adr/0001-wind-limit.md":
        "# 0001. The wind limit\n\n- Status: accepted\n\n## Decision\n\nWarn above 45 km/h.\n",
    },
    expect: { errors: [], contradictions: [] },
    scripted: { findings: [] },
  },
  {
    id: "behaviour-without-spec",
    description: "A new rule in the code, no spec touched.",
    head: {
      "src/tools/weather.ts": `${WEATHER}\nexport function warnsOfFog(visibilityM: number): boolean {\n  return visibilityM < 200;\n}\n`,
    },
    expect: { errors: ["code-without-spec"], contradictions: [] },
    scripted: { findings: [] },
  },
  {
    id: "guide-only",
    description: "A page of the guide changes, nothing else.",
    head: { "docs/guide/weather.md": "# Weather\n\nThe app warns about rain and wind.\n" },
    expect: { errors: [], contradictions: [] },
    scripted: { findings: [] },
  },
  {
    id: "guide-with-code",
    description: "The code changes and so does a page of the guide, but the spec does not.",
    head: {
      "src/tools/weather.ts": WEATHER.replace("= 50;", "= 70;"),
      "docs/guide/weather.md": "# Weather\n\nThe app warns about rain and wind above 70 km/h.\n",
    },
    // The record of the limit still says 50 as well, so "ADR 0001" is a true finding a model may add.
    expect: { errors: ["code-without-spec"], contradictions: ["Wind warning"], allowed: ["ADR 0001"] },
    scripted: {
      findings: [
        {
          kind: "contradiction",
          severity: "high",
          confidence: "high",
          requirement: "Wind warning",
          spec: {
            file: "openspec/specs/weather-daylight/spec.md",
            line: 0,
            quote: "warn the rider when the crosswind is above 50 km/h",
          },
          code: { file: "src/tools/weather.ts", line: 0, quote: "export const WIND_WARNING_KMH = 70;" },
          explanation: "The code warns above 70 km/h, the requirement says 50.",
          action: "decide",
        },
      ],
    },
  },
  {
    id: "threshold-contradiction",
    description: "The rain threshold moves in the code while the spec only gains a line about something else.",
    head: {
      "src/tools/weather.ts": WEATHER.replace("= 40;", "= 60;"),
      "openspec/specs/weather-daylight/spec.md": `${RAIN_SPEC}\n### Requirement: Daylight\n\nThe system SHALL give sunrise and sunset.\n\n#### Scenario: A winter day\n\n- **WHEN** the rider asks\n- **THEN** both times are given\n`,
    },
    expect: { errors: [], contradictions: ["Rain warning"] },
    scripted: {
      findings: [
        {
          kind: "contradiction",
          severity: "high",
          confidence: "high",
          requirement: "Rain warning",
          spec: rainQuote,
          code: { file: "src/tools/weather.ts", line: 0, quote: "export const RAIN_WARNING_PERCENT = 60;" },
          explanation: "The rider is warned above 60 percent, the requirement says 40.",
          action: "fix-code",
        },
      ],
    },
  },
  {
    id: "refactor",
    description: "An internal rename, said so in the commit.",
    head: { "src/tools/weather.ts": WEATHER.replaceAll("warnsOfRain", "isRainy") },
    messages: ["refactor(weather): rename a helper\n\nNo-Spec: internal rename, same behaviour"],
    expect: { errors: [], contradictions: [] },
    scripted: { findings: [] },
  },
  {
    id: "invented-citation",
    description: "The change is fine, and a model invents a contradiction with a quote that is not in the file.",
    head: { "src/tools/weather.ts": WEATHER.replaceAll("warnsOfRain", "isRainy") },
    messages: ["refactor(weather): rename a helper\n\nNo-Spec: internal rename, same behaviour"],
    expect: { errors: [], contradictions: [] },
    scripted: {
      findings: [
        {
          kind: "contradiction",
          severity: "high",
          confidence: "high",
          requirement: "Rain warning",
          spec: rainQuote,
          code: { file: "src/tools/weather.ts", line: 3, quote: "return chance >= RAIN_WARNING_PERCENT + 25;" },
          explanation: "The comparison was loosened.",
          action: "fix-code",
        },
      ],
    },
  },
];
