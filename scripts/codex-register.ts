// Registers agentRide as an MCP server in the user's Codex config, with
// absolute paths, and prints the approval line Codex still needs.
// Codex has no project-local MCP config, so this is done once per machine.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = [
  "mcp", "add", "ride",
  "--env", `RIDE_SCOUTS=${process.env.RIDE_SCOUTS ?? "0"}`,
  "--", "node", `--env-file-if-exists=${root}/.env`, `${root}/src/mcp.ts`,
];
console.log(`codex ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
const result = spawnSync("codex", args, { stdio: "inherit" });
if (result.error) {
  console.error(`codex not found on PATH (${result.error.message}). Install Codex CLI, or add the block from codex/config.example.toml to ~/.codex/config.toml by hand.`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`
Registered. One more line in ~/.codex/config.toml, under [mcp_servers.ride], or Codex asks before every tool call:

  default_tools_approval_mode = "approve"     # or "writes": lookups free, saves and settings ask

Scouts are off (RIDE_SCOUTS=0) so planning runs on your Codex plan alone; remove that env entry to enable them on the Anthropic key.
Then: codex, and ask for a ride in plain words.`);
