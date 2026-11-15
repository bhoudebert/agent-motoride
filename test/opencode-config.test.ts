import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

test("opencode.json declares the same ride server as .mcp.json", () => {
  const { command, args } = read(".mcp.json").mcpServers.ride;
  const ride = read("opencode.json").mcp.ride;
  assert.deepEqual(ride.command, [command, ...args]);
  assert.equal(ride.type, "local");
  assert.equal(ride.enabled, true);
});
