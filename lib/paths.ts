import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const HOME = os.homedir();

/** Per-XDG data directory for this app's own state (DB + backups). */
export const DATA_DIR =
  process.env.MCP_MANAGE_DATA_DIR ||
  path.join(
    process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share"),
    "mcp-manage",
  );

export const DB_PATH = path.join(DATA_DIR, "mcp-manage.db");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");

/** Resolve a path that may start with ~ to an absolute path. */
export function expandHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  return p;
}

let ensured = false;
export function ensureDataDirs(): void {
  if (ensured) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  ensured = true;
}
