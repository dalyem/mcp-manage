import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { backups } from "../db/schema";
import { BACKUPS_DIR } from "../paths";
import { dirExists, fileExists } from "../fs-utils";
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
    .values({ agentKey, originalPath, content, backupPath, kind: "file" })
    .run();

  return backupPath;
}

/**
 * Back up an entire skill directory before we overwrite or remove it. Copies the
 * whole tree (binary-safe) into
 * ~/.local/share/mcp-manage/backups/<agent>/skills/<name>.<ts>/ and records a
 * kind="dir" row. The copied tree itself is the manifest — no inline content is
 * stored in the DB. Returns the backup root, or null if the dir didn't exist.
 */
export function backupSkillDir(
  agentKey: AgentKey,
  skillDir: string,
): string | null {
  if (!dirExists(skillDir)) return null;
  const dir = path.join(BACKUPS_DIR, agentKey, "skills");
  fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `${path.basename(skillDir)}.${stamp()}`);
  try {
    fs.cpSync(skillDir, backupPath, { recursive: true });
  } catch {
    return null;
  }

  db.insert(backups)
    .values({
      agentKey,
      originalPath: skillDir,
      content: null,
      backupPath,
      kind: "dir",
    })
    .run();

  return backupPath;
}

export function restoreBackup(id: number): { restored: string } {
  const row = db.select().from(backups).where(eq(backups.id, id)).get();
  if (!row) throw new Error(`backup ${id} not found`);

  if (row.kind === "dir") {
    if (!dirExists(row.backupPath)) {
      throw new Error(`backup ${id} directory tree is missing`);
    }
    // Exact restore: replace the current skill directory with the backed-up
    // tree (the backup captured the full pre-write dir, including any files we
    // don't manage, so this faithfully reverts the whole skill folder).
    fs.rmSync(row.originalPath, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(row.originalPath), { recursive: true });
    fs.cpSync(row.backupPath, row.originalPath, { recursive: true });
    return { restored: row.originalPath };
  }

  if (row.content == null) throw new Error(`backup ${id} has no stored content`);
  fs.mkdirSync(path.dirname(row.originalPath), { recursive: true });
  fs.writeFileSync(row.originalPath, row.content, "utf8");
  return { restored: row.originalPath };
}
