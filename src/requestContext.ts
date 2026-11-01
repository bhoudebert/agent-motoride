import { AsyncLocalStorage } from "node:async_hooks";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * What belongs to one rider while a request of theirs is served by a multi-user instance (ADR 0027): the start-point
 * anchor that biases place names, the persistent place-name cache wired to their library, and the folder their files
 * are confined to. Used alone (stdio, terminal), there is no request and the default context is the one process-wide
 * state there always was.
 */
export interface RequestContext {
  anchor?: { lat: number; lon: number };
  /** Places resolved so far: what a name means depends on the anchor, so each rider has their own. */
  places?: Map<string, { lat: number; lon: number; label: string }>;
  persistent?: { get(key: string): string | undefined; set(key: string, value: string): void };
  /** Set on a server: every path a tool reads or writes stays inside this folder. */
  fileRoot?: string;
  /**
   * Set for a hosted rider (ADR 0057): whether the rider's plan lets the traffic tool call TomTom, counting the call against the
   * day's allowance when it does. Absent: no limit beyond the host's.
   */
  trafficGate?: () => "ok" | "not_included" | "daily_limit";
}

export const defaultContext: RequestContext = {};
const storage = new AsyncLocalStorage<RequestContext>();

export const currentContext = (): RequestContext => storage.getStore() ?? defaultContext;

/** Run `fn` as a rider's request: everything it awaits sees that rider's context. */
export const runInContext = <T>(context: RequestContext, fn: () => T): T => storage.run(context, fn);

/**
 * A path a tool was given, kept inside the rider's folder when there is one (a relative path is taken from `folder`
 * in it: `exports` for what is written); with no folder, the path as given. A path that leaves the folder, by `..`, by being absolute elsewhere or by `~`, is refused.
 */
export function inRoot(path: string, folder = ""): string {
  const root = currentContext().fileRoot;
  if (!root) return path;
  const resolved = resolve(root, folder, path);
  const rel = relative(root, resolved);
  if (path.startsWith("~") || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      "On a server, files stay inside your own folder: give a name without a directory, or a path inside it.",
    );
  }
  return resolved;
}

/** Where exports go by default: the rider's own `exports/` on a server, else `fallback`. */
export function exportDir(fallback: string): string {
  const root = currentContext().fileRoot;
  return root ? resolve(root, "exports") : fallback;
}
