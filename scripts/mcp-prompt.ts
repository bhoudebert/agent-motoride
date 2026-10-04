// Prints the plan-ride prompt exactly as the server serves it. RIDE_DB should point at a scratch file.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "prompt-check", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["--env-file-if-exists=.env", "src/mcp.ts"],
    env: { ...process.env } as Record<string, string>,
    stderr: "pipe",
  }),
);
const prompt: any = await client.getPrompt({ name: "plan-ride", arguments: { request: process.argv[2] ?? "test" } });
console.log(prompt.messages[0].content.text);
await client.close();
