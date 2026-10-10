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
import { CAPABILITIES, MOMENTS } from "../src/capabilities.ts";
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

/** The four MCP hints of a tool, in words. */
function hints(a: {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}) {
  return `_${[
    a.readOnlyHint ? "read-only" : "writes",
    ...(a.readOnlyHint
      ? []
      : [a.destructiveHint ? "may overwrite" : "not destructive", a.idempotentHint ? "idempotent" : "not idempotent"]),
    a.openWorldHint ? "uses online services" : "local only",
  ].join(" · ")}_`;
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

${tools.length} tools, ${prompts.length} prompts. Each tool shows its MCP hints: a client can let read-only tools run without asking.

### Tools

${tools
  .map(
    (t) =>
      `#### \`${t.name}\`\n\n${hints(t.annotations ?? {})}\n\n${t.description ?? ""}\n\n${inputs(t.inputSchema as JsonSchema)}`,
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

// The same catalogue the MCP help and `rides help` use, as a guide page and a
// list on the project site, so neither can fall behind the code.
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const everythingPage = join(root, "docs/guide/everything.md");
const everything = `# Everything you can do

<!-- Generated from src/capabilities.ts by npm run docs:reference. Do not edit by hand. -->

Every feature of agentMotoride, by moment. In Claude Code or Codex, say it in
plain words (the **Say** column); in Claude Code, slash commands are
shortcuts. In the terminal, use the commands; \`npm run rides -- help\` prints
this list, and \`/mcp__ride__help\` (or asking "what can you do?") shows it in
Claude Code or Codex. Every option is in the [reference](/reference).

${MOMENTS.map(
  (moment) => `## ${moment}

| What | Say | Terminal | Shortcut |
| --- | --- | --- | --- |
${CAPABILITIES.filter((c) => c.moment === moment)
  .map(
    (c) =>
      `| ${td(c.what)} | "${td(c.say)}" | ${c.terminal.map((t) => `\`${td(t)}\``).join("<br>")} | ${c.slash ? `\`/mcp__ride__${td(c.slash)}\`` : ""} |`,
  )
  .join("\n")}`,
).join("\n\n")}
`;
const sitePage = join(root, "site/index.html");
const START = "<!-- capabilities:start -->";
const END = "<!-- capabilities:end -->";
const siteList = `${START}
  <div class="everything">
${MOMENTS.map(
  (moment) => `    <div>
      <h3>${esc(moment)}</h3>
      <ul>
${CAPABILITIES.filter((c) => c.moment === moment)
  .map((c) => `        <li>${esc(c.what)}<q>${esc(c.say)}</q></li>`)
  .join("\n")}
      </ul>
    </div>`,
).join("\n")}
  </div>
  ${END}`;
const site = readFileSync(sitePage, "utf8");
if (!site.includes(START) || !site.includes(END)) throw new Error(`site/index.html lacks the ${START} markers`);
const siteNext = site.replace(new RegExp(`${START}[\\s\\S]*?${END}`), siteList);

const outputs = [
  {
    path: page,
    content: await prettier.format(text, { ...(await prettier.resolveConfig(page)), filepath: page }),
  },
  {
    path: everythingPage,
    content: await prettier.format(everything, {
      ...(await prettier.resolveConfig(everythingPage)),
      filepath: everythingPage,
    }),
  },
  { path: sitePage, content: siteNext },
];

if (process.argv.includes("--check")) {
  const stale = outputs.filter((o) => {
    try {
      return readFileSync(o.path, "utf8") !== o.content;
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(
      `Out of date with the code: ${stale.map((o) => o.path.replace(`${root}/`, "")).join(", ")}. Run: npm run docs:reference`,
    );
    process.exit(1);
  }
  console.log("Reference, capabilities page and site list match the code.");
} else {
  for (const o of outputs) writeFileSync(o.path, o.content);
  console.log(
    `Wrote docs/guide/reference.md (${tools.length} tools, ${prompts.length} prompts), docs/guide/everything.md and the site list (${CAPABILITIES.length} capabilities).`,
  );
}
