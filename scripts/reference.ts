// Generate the guide's reference page from what the code actually says:
// the terminal help texts, the MCP server's tools, prompts and resources (read
// through a real MCP client, as Claude Code or Codex see them), and .env.example.
//   npm run docs:reference            write docs/guide/reference.md
//   npm run docs:reference -- --check fail when the page is out of date (CI)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import prettier from "prettier";
import { cell } from "../src/markdown.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const page = join(root, "docs/guide/reference.md");
// A throwaway library: generating the reference never touches the rider's.
const env: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  RIDE_DB: join(mkdtempSync(join(tmpdir(), "ride-reference-")), "rides.db"),
  RIDE_SCOUTS: "0",
};

/** Text for a Markdown table cell: backslashes and pipes escaped, line breaks folded. */
const td = (text: string) => cell(text.replace(/\s*\n\s*/g, " "));

const run = (args: string[]) => execFileSync(process.execPath, args, { cwd: root, env, encoding: "utf8" }).trimEnd();

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
}

const typeOf = (s: JsonSchema): string =>
  s.enum
    ? s.enum.map((v) => `"${v}"`).join(" \\| ")
    : s.type === "array"
      ? `${typeOf(s.items ?? {})}[]`
      : (s.type ?? "");

/** One line per input: name, type, whether required, its description. */
function inputs(schema: JsonSchema): string {
  const props = Object.entries(schema.properties ?? {});
  if (!props.length) return "No input.\n";
  return `${props
    .map(([name, s]) => {
      const required = schema.required?.includes(name) ? "" : ", optional";
      return `- \`${name}\` (${typeOf(s)}${required})${s.description ? `: ${s.description}` : ""}`;
    })
    .join("\n")}\n`;
}

/** Settings of .env.example: each with its default and the comment right above it. */
function settings(): string {
  const rows: string[] = [];
  let comment: string[] = [];
  for (const line of readFileSync(join(root, ".env.example"), "utf8").split("\n")) {
    const variable = /^(#\s*)?([A-Z][A-Z0-9_]+)=(\S*)$/.exec(line);
    if (variable) {
      const [, commented, name, value] = variable;
      // A commented line shows the default; an open one is for you to fill in.
      const shown = commented ? (value ? `\`${value}\`` : "unset") : "to set";
      rows.push(`| \`${name}\` | ${shown} | ${td(comment.join(" "))} |`);
      comment = [];
    } else if (line.startsWith("#")) comment.push(line.replace(/^#\s?/, "").trim());
    else comment = [];
  }
  return `| Setting | Default | What for |\n| --- | --- | --- |\n${rows.join("\n")}\n`;
}

async function server() {
  const client = new Client({ name: "reference", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ["src/mcp.ts"], cwd: root, env, stderr: "ignore" }),
  );
  try {
    const tools = (await client.listTools()).tools;
    const prompts = (await client.listPrompts()).prompts;
    const resources = (await client.listResources()).resources;
    const templates = (await client.listResourceTemplates()).resourceTemplates;
    return { tools, prompts, resources, templates };
  } finally {
    await client.close();
  }
}

const { tools, prompts, resources, templates } = await server();
const fence = (text: string) => `\`\`\`text\n${text}\n\`\`\`\n`;

const text = `# Reference

Generated from the code by \`npm run docs:reference\`; CI fails when it is out
of date, so what is listed here is what the app does. For explanations, see the
task pages of this guide.

## The terminal app

### \`npm run ride\`

${fence(run(["src/index.ts", "--help"]))}
### \`npm run rides\`

${fence(run(["src/rides.ts", "help"]))}
## Claude Code and Codex (MCP server)

${tools.length} tools, ${prompts.length} prompts. Read-only tools are marked; a client can let them run without asking.

### Tools

${tools
  .map(
    (t) =>
      `#### \`${t.name}\`${t.annotations?.readOnlyHint ? " (read-only)" : ""}\n\n${t.description ?? ""}\n\n${inputs(t.inputSchema as JsonSchema)}`,
  )
  .join("\n")}
### Prompts

Slash commands in Claude Code (\`/mcp__ride__<name>\`); plain words do the same in any client.

| Prompt | Arguments | Does |
| --- | --- | --- |
${prompts
  .map(
    (p) =>
      `| \`${p.name}\` | ${(p.arguments ?? []).map((a) => `\`${a.name}\`${a.required ? "" : " (optional)"}`).join(", ") || "none"} | ${td(p.description ?? "")} |`,
  )
  .join("\n")}

### Resources

| Resource | About |
| --- | --- |
${[
  ...resources
    .filter((r) => !r.uri.startsWith("ride://ride/"))
    .map((r) => `| \`${r.uri}\` | ${td(r.description ?? r.name)} |`),
  ...templates.map((t) => `| \`${t.uriTemplate}\` | ${td(t.description ?? t.name)} |`),
].join("\n")}

## Settings (\`.env\`)

${settings()}`;

const formatted = await prettier.format(text, {
  ...(await prettier.resolveConfig(page)),
  filepath: page,
});

if (process.argv.includes("--check")) {
  const current = readFileSync(page, "utf8");
  if (current !== formatted) {
    console.error("docs/guide/reference.md is out of date with the code. Run: npm run docs:reference");
    process.exit(1);
  }
  console.log("Reference matches the code.");
} else {
  writeFileSync(page, formatted);
  console.log(`Wrote docs/guide/reference.md: ${tools.length} tools, ${prompts.length} prompts.`);
}
