// GitHub backup settings, persisted as a single JSON blob in the existing
// `app_meta` key/value table (no new table — keeps the self-bootstrapping DDL in
// lib/db/client.ts untouched). The PAT lives here (local SQLite, outside any
// repo) and is NEVER serialized to the browser: routes return the masked
// `GitHubConfigPublic` projection instead.
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appMeta } from "../db/schema";

const CONFIG_KEY = "github.config";

export interface GitHubLastBackup {
  at: string;
  commitSha: string;
  commitUrl: string;
  counts: { servers: number; subagents: number };
}

/** Full server-side config, including the secret token. Never sent to a client. */
export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  /** optional sub-directory inside the repo; "" = repo root */
  pathPrefix: string;
  autoBackup: boolean;
  lastBackup: GitHubLastBackup | null;
}

/** Browser-safe projection: no token, just a masked hint. */
export interface GitHubConfigPublic {
  configured: boolean;
  owner: string;
  repo: string;
  branch: string;
  pathPrefix: string;
  autoBackup: boolean;
  lastBackup: GitHubLastBackup | null;
  /** masked hint like "ghp_…1a2b", or "" when no token is stored */
  tokenHint: string;
}

const DEFAULTS: GitHubConfig = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
  pathPrefix: "",
  autoBackup: false,
  lastBackup: null,
};

export function getGitHubConfig(): GitHubConfig | null {
  const row = db
    .select()
    .from(appMeta)
    .where(eq(appMeta.key, CONFIG_KEY))
    .get();
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<GitHubConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return null;
  }
}

export function isConfigured(c: GitHubConfig | null): c is GitHubConfig {
  return !!(c && c.token && c.owner && c.repo);
}

function maskToken(token: string): string {
  if (!token) return "";
  const last4 = token.slice(-4);
  const prefixMatch = token.match(/^(ghp_|gho_|ghs_|ghr_|github_pat_)/);
  return prefixMatch ? `${prefixMatch[1]}…${last4}` : `…${last4}`;
}

export function toPublic(c: GitHubConfig | null): GitHubConfigPublic {
  const cfg = c ?? DEFAULTS;
  return {
    configured: isConfigured(c),
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    pathPrefix: cfg.pathPrefix,
    autoBackup: cfg.autoBackup,
    lastBackup: cfg.lastBackup,
    tokenHint: maskToken(cfg.token),
  };
}

export function getGitHubConfigPublic(): GitHubConfigPublic {
  return toPublic(getGitHubConfig());
}

function write(cfg: GitHubConfig): void {
  const value = JSON.stringify(cfg);
  db.insert(appMeta)
    .values({ key: CONFIG_KEY, value })
    .onConflictDoUpdate({ target: appMeta.key, set: { value } })
    .run();
}

/**
 * Merge a partial patch over the stored config. An empty/undefined `token` in
 * the patch PRESERVES the existing token, so the UI can save repo/branch/auto
 * settings without re-sending the secret.
 */
export function saveGitHubConfig(patch: Partial<GitHubConfig>): GitHubConfig {
  const current = getGitHubConfig() ?? DEFAULTS;
  const next: GitHubConfig = { ...current, ...patch };
  if (!patch.token) next.token = current.token;
  next.branch = next.branch.trim() || "main";
  next.owner = next.owner.trim();
  next.repo = next.repo.trim();
  next.pathPrefix = next.pathPrefix.trim().replace(/^\/+|\/+$/g, "");
  write(next);
  return next;
}

export function setLastBackup(meta: GitHubLastBackup): void {
  const current = getGitHubConfig();
  if (!current) return;
  write({ ...current, lastBackup: meta });
}

export function setAutoBackup(enabled: boolean): void {
  const current = getGitHubConfig();
  if (!current) return;
  write({ ...current, autoBackup: enabled });
}
