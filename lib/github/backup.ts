// Orchestrates a backup (build -> redact -> render -> push) and the optional
// auto-backup-after-sync trigger. The auto path is fire-and-forget and debounced
// so a burst of CRUD edits (each of which syncs) coalesces into one commit. This
// relies on the app being a single persistent process (the systemd service), so
// a module-level timer is safe here.
import {
  getGitHubConfig,
  isConfigured,
  setLastBackup,
  type GitHubConfig,
  type GitHubLastBackup,
} from "./config";
import { pushFiles } from "./client";
import { buildSnapshot, redactSnapshot, renderSnapshotFiles } from "./snapshot";

/** Build, redact, push, and record a backup. Returns the recorded metadata. */
export async function performBackup(cfg: GitHubConfig): Promise<GitHubLastBackup> {
  const snap = buildSnapshot();
  const files = renderSnapshotFiles(redactSnapshot(snap));
  const counts = { servers: snap.servers.length, subagents: snap.subagents.length };
  const message = `mcp-manage backup — ${snap.generatedAt} (${counts.servers} servers, ${counts.subagents} subagents)`;
  const { commitSha, commitUrl } = await pushFiles(cfg, files, message);
  const meta: GitHubLastBackup = {
    at: new Date().toISOString(),
    commitSha,
    commitUrl,
    counts,
  };
  setLastBackup(meta);
  return meta;
}

const DEBOUNCE_MS = 8000;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending = false;

async function runScheduled(): Promise<void> {
  timer = null;
  if (!pending) return;
  pending = false;
  const cfg = getGitHubConfig();
  if (!isConfigured(cfg) || !cfg.autoBackup) return;
  try {
    await performBackup(cfg);
  } catch (e) {
    // Auto-backup must never break the request that triggered it; log only.
    console.error(
      "[mcp-manage] auto-backup failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Schedule a debounced auto-backup if GitHub is configured and autoBackup is on.
 * Returns immediately; the push happens later off the request path. Safe to call
 * after every sync — bursts coalesce into a single commit.
 */
export function maybeAutoBackup(): void {
  // Best-effort: scheduling a backup must never turn a successful mutation into
  // a 500, so this never throws to its callers (the route handlers).
  try {
    const cfg = getGitHubConfig();
    if (!isConfigured(cfg) || !cfg.autoBackup) return;
    pending = true;
    if (timer) return;
    timer = setTimeout(runScheduled, DEBOUNCE_MS);
    // Don't keep the event loop alive solely for a pending backup.
    (timer as unknown as { unref?: () => void }).unref?.();
  } catch (e) {
    console.error(
      "[mcp-manage] auto-backup scheduling failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
