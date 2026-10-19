// Administration of a multi-user instance (ADR 0027): `npm run admin -- <command>`, or `nix run .#admin -- <command>`.
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { DATA_DIR } from "./dataDir.ts";
import { backupAll, librarySize, Registry, removeLibrary, type Tenant } from "./tenants.ts";

const USAGE = `Usage: npm run admin -- <command>

  add <email>                  Register a rider: prints the token (shown once) and how to connect
  list [--json]                Riders: identifier, email, status, size of the library, last seen
  remove <id|email> [--purge --yes]
                               Forget a rider: the token stops working at once; the library is put aside in
                               data/removed/, or deleted with --purge --yes
  suspend <id|email>           The token stops working until resumed; nothing is lost
  resume <id|email>            Let a suspended rider back in
  token <id|email>             A new token; the old one stops working at once
  backup [folder]              A consistent copy of the registry and every library into <folder>/<date>/
                               (default: data/backups)

The address riders connect to is RIDE_SERVER_URL (for the connection text), e.g. https://rides.example.org.`;

const mb = (bytes: number) => (bytes ? `${(bytes / 1_048_576).toFixed(1)} MB` : "-");
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "never");

/** How a rider connects Claude Code or Codex, with the token that is shown once. */
export function connectionText(
  tenant: Tenant,
  token: string,
  base = process.env.RIDE_SERVER_URL ?? "https://YOUR-SERVER",
): string {
  const url = `${base.replace(/\/+$/, "")}/mcp`;
  return [
    `Rider ${tenant.email} (${tenant.id})`,
    `Token (shown once, keep it): ${token}`,
    "",
    "Claude Code:",
    `  claude mcp add --transport http ride ${url} --header "Authorization: Bearer ${token}"`,
    "Codex (~/.codex/config.toml):",
    `  [mcp_servers.ride]\n  url = "${url}"\n  bearer_token_env_var = "RIDE_TOKEN"   # and export RIDE_TOKEN=${token}`,
  ].join("\n");
}

export function listText(registry: Registry): string {
  const rows = registry.list();
  if (!rows.length) return "No riders yet. Add one: npm run admin -- add <email>";
  const lines = rows.map(
    (t) =>
      `${t.id}  ${t.email.padEnd(32)}  ${t.status.padEnd(9)}  ${mb(librarySize(t.id)).padStart(8)}  ${when(t.lastSeenAt)}`,
  );
  return [`${"id".padEnd(36)}  ${"email".padEnd(32)}  ${"status".padEnd(9)}  library  last seen`, ...lines].join("\n");
}

async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error(`${question}\nNot done: add --yes to confirm without a terminal.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export async function run(
  argv: string[],
  registry = new Registry(),
  out: (s: string) => void = console.log,
): Promise<void> {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--"));
  const target = args[0];
  const need = (what: string) => {
    if (!target) throw new Error(`Which rider? ${what}`);
    return target;
  };
  switch (command) {
    case "add": {
      const { tenant, token } = registry.add(need("Give an email: add <email>"));
      out(connectionText(tenant, token));
      break;
    }
    case "list":
      out(
        flags.has("--json")
          ? JSON.stringify(
              registry.list().map((t) => ({ ...t, libraryBytes: librarySize(t.id) })),
              null,
              2,
            )
          : listText(registry),
      );
      break;
    case "suspend":
    case "resume": {
      const tenant = registry.setStatus(need(`${command} <id|email>`), command === "suspend" ? "suspended" : "active");
      out(`${tenant.email} is ${tenant.status}.`);
      break;
    }
    case "token": {
      const { tenant, token } = registry.rekey(need("token <id|email>"));
      out(`New token for ${tenant.email}; the old one no longer works.\n${connectionText(tenant, token)}`);
      break;
    }
    case "remove": {
      const found = registry.find(need("remove <id|email>"));
      if (!found) throw new Error(`No tenant matches "${target}". Run: npm run admin -- list`);
      const purge = flags.has("--purge");
      const question = purge
        ? `Remove ${found.email} and DELETE its library for good?`
        : `Remove ${found.email}? Its library is kept in data/removed/.`;
      if (!(await confirm(question, flags.has("--yes")))) {
        out("Not removed.");
        break;
      }
      registry.remove(found.id);
      const aside = removeLibrary(found.id, purge);
      out(
        purge
          ? `${found.email} removed, library deleted.`
          : `${found.email} removed.${aside ? ` Library kept at ${aside}.` : ""}`,
      );
      break;
    }
    case "backup": {
      const { folder, copied } = backupAll(registry, resolve(target ?? resolve(DATA_DIR, "backups")));
      out(`Backed up to ${folder}: ${copied.join(", ")}.`);
      break;
    }
    case undefined:
    case "help":
    case "--help":
      out(USAGE);
      break;
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    await run(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
