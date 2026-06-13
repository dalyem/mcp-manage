import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { backups } from "../db/schema";
import { BACKUPS_DIR } from "../paths";
import { fileExists } from "../fs-utils";
import type { AgentKey } from "../types";

/** Filesystem-safe timestamp for backup filenames. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Back up a file before we overwrite it. Copies the current content into
 * ~/.local/share/mcp-manage/backups/<agent>/<basename>.<ts>.bak and records it
 * in the backups table. Returns the backup path, or null if there was nothing
 * to back up (file didn't exist yet).
 */
export function backupFile(
  agentKey: AgentKey,
  originalPath: string,
): string | null {
  if (!fileExists(originalPath)) return null;
  let content: string;
  try {
    content = fs.readFileSync(originalPath, "utf8");
  } catch {
    return null;
  }
  const dir = path.join(BACKUPS_DIR, agentKey);
  fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(
    dir,
    `${path.basename(originalPath)}.${stamp()}.bak`,
  );
  fs.writeFileSync(backupPath, content, "utf8");

  db.insert(backups)
    .values({ agentKey, originalPath, content, backupPath })
    .run();

  return backupPath;
}

export function restoreBackup(id: number): { restored: string } {
  const row = db.select().from(backups).where(eq(backups.id, id)).get();
  if (!row) throw new Error(`backup ${id} not found`);
  if (row.content == null) throw new Error(`backup ${id} has no stored content`);
  fs.mkdirSync(path.dirname(row.originalPath), { recursive: true });
  fs.writeFileSync(row.originalPath, row.content, "utf8");
  return { restored: row.originalPath };
}
