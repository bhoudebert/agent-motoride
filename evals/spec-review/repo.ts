import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Files by path; null deletes the file. */
export type Files = Record<string, string | null>;

export interface BuiltRepo {
  dir: string;
  base: string;
  head: string;
  cleanup(): void;
}

const git = (dir: string, args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

function write(dir: string, files: Files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    if (content === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
}

/** A throwaway Git repository: `main` holds the base files, `change` the head files, one commit per message. */
export function buildRepo(base: Files, head: Files, messages: string[] = ["change"]): BuiltRepo {
  const dir = mkdtempSync(join(tmpdir(), "spec-review-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "rider@example.org"]);
  git(dir, ["config", "user.name", "Rider"]);
  write(dir, base);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "base"]);
  git(dir, ["checkout", "-q", "-b", "change"]);
  write(dir, head);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", messages[0] ?? "change"]);
  for (const message of messages.slice(1)) git(dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return { dir, base: "main", head: "change", cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
