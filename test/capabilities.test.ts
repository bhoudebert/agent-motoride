import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CAPABILITIES, formatForClients, formatForTerminal, MOMENTS } from "../src/capabilities.ts";

const env = {
  PATH: process.env.PATH ?? "",
  RIDE_DB: join(mkdtempSync(join(tmpdir(), "ride-caps-")), "rides.db"),
  RIDE_SCOUTS: "0",
};
const run = (args: string[]) => {
  try {
    return execFileSync(process.execPath, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return String((error as { stdout: string }).stdout);
  }
};
const terminal = CAPABILITIES.flatMap((c) => c.terminal);

test("capabilities: every MCP tool and prompt is in the catalogue, so help never forgets one", async () => {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ["src/mcp.ts"], env, stderr: "pipe" }),
  );
  try {
    const listed = new Set(CAPABILITIES.flatMap((c) => c.tools));
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.deepEqual(
      tools.filter((t) => !listed.has(t)),
      [],
      "tools missing from src/capabilities.ts",
    );
    const slashes = new Set(CAPABILITIES.flatMap((c) => (c.slash ? [c.slash.split(" ")[0]!] : [])));
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    const hidden = new Set(["list-rides"]); // reached through list-roadbooks' entry, listed with it
    assert.deepEqual(
      prompts.filter((p) => !slashes.has(p) && !hidden.has(p)),
      [],
      "prompts missing from src/capabilities.ts",
    );
    const help = await client.getPrompt({ name: "help", arguments: {} });
    assert.match((help.messages[0]!.content as { text: string }).text, /rate-stretch <from> <to>/);
    const caps = (await client.callTool({ name: "capabilities", arguments: {} })) as {
      content: Array<{ text: string }>;
    };
    assert.equal(caps.content[0]!.text, formatForClients());
  } finally {
    await client.close();
  }
});

test("capabilities: every rides command and refine> command is in the catalogue", () => {
  const usage = run(["src/rides.ts", "no-such-command"]);
  const commands = [...new Set([...usage.matchAll(/^ {2}([a-z][a-z-]+)\b/gm)].map((m) => m[1]!))];
  assert.ok(commands.length > 25, `parsed ${commands.length} commands`);
  assert.deepEqual(
    commands.filter((c) => !terminal.some((t) => t.startsWith(`npm run rides -- ${c}`))),
    [],
    "rides commands missing from src/capabilities.ts",
  );
  const refine = run(["src/index.ts", "--help"]);
  const slashes = [...new Set([...refine.matchAll(/^ {2}(\/[a-z]+)\b/gm)].map((m) => m[1]!))];
  assert.ok(slashes.length > 15, `parsed ${slashes.length} refine commands`);
  assert.deepEqual(
    slashes.filter((s) => !terminal.some((t) => t === s || t.startsWith(`${s} `))),
    [],
    "refine> commands missing from src/capabilities.ts",
  );
});

test("capabilities: both renderings group by moment and give each entry its way in", () => {
  const forClients = formatForClients();
  const forTerminal = formatForTerminal();
  for (const moment of MOMENTS) {
    assert.match(forClients, new RegExp(`^${moment.toUpperCase()}$`, "m"));
    assert.match(forTerminal, new RegExp(`^${moment.toUpperCase()}$`, "m"));
  }
  assert.match(
    forClients,
    /say: "the stretch from Rue de Longuesault 1, Tournai to Hollain was very nice, 5"\s+or \/mcp__ride__rate-stretch/,
  );
  assert.match(forTerminal, /\n {4}npm run rides -- rate-stretch "<from>" "<to>" <0-5> \[note\]/);
  assert.ok(
    CAPABILITIES.every((c) => c.say && c.what && c.terminal.length),
    "every entry is complete",
  );
});
