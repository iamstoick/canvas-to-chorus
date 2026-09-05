import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

function executable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the `claude` binary. Order: explicit path, PATH entries, then the usual install spots.
 * Returns null when nothing executable is found.
 */
export function resolveClaudeCli(explicit?: string | null): string | null {
  if (explicit) return executable(explicit) ? explicit : null;
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = [
    ...pathDirs.map((d) => path.join(d, "claude")),
    path.join(os.homedir(), ".local", "bin", "claude"),
    path.join(os.homedir(), ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  return candidates.find(executable) ?? null;
}
