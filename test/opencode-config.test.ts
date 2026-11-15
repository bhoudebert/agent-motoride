import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const json = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

test("opencode.json starts the same server as .mcp.json", () => {
  const claude = json(".mcp.json").mcpServers.ride;
  const ride = json("opencode.json").mcp.ride;
  assert.equal(ride.type, "local");
  assert.deepEqual(ride.command, [claude.command, ...claude.args]);
});
