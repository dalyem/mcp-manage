// Minimal GitHub REST client built on the global fetch — no extra dependencies.
// Backups are pushed as a single atomic commit via the Git Data API (blobs ->
// tree -> commit -> ref). Errors are mapped to clean, token-free messages.
import type { GitHubConfig } from "./config";
import type { SnapshotFile } from "./snapshot";

const API = "https://api.github.com";

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mcp-manage",
  };
}

function repoPath(cfg: GitHubConfig): string {
  return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
}

function prefixed(cfg: GitHubConfig, p: string): string {
  return cfg.pathPrefix ? `${cfg.pathPrefix}/${p}` : p;
}

async function toError(res: Response): Promise<GitHubError> {
  let ghMessage = "";
  try {
    const data = (await res.json()) as { message?: unknown };
    if (typeof data.message === "string") ghMessage = data.message;
  } catch {
    // no/invalid JSON body
  }
  switch (res.status) {
    case 401:
      return new GitHubError(
        "GitHub rejected the token — check it hasn't expired and has the right scope (classic: repo; fine-grained: Contents read & write).",
        401,
      );
    case 403:
      if (res.headers.get("x-ratelimit-remaining") === "0")
        return new GitHubError("GitHub API rate limit reached — try again later.", 403);
      return new GitHubError(
        "Access forbidden — the token lacks permission for this repository (fine-grained tokens need Contents: read & write).",
        403,
      );
    case 404:
      return new GitHubError(
        "Not found — check the owner/repo and branch, and that the token can access this repository.",
        404,
      );
    case 409:
      return new GitHubError(ghMessage || "Git repository is empty.", 409);
    case 422:
      return new GitHubError(ghMessage || "GitHub rejected the request (validation error).", 422);
    default:
      return new GitHubError(
        ghMessage
          ? `GitHub API error (${res.status}): ${ghMessage}`
          : `GitHub API error (${res.status}).`,
        res.status,
      );
  }
}

async function gh<T>(
  cfg: GitHubConfig,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${apiPath}`, {
    method,
    headers: {
      ...authHeaders(cfg.token),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Latest commit SHA for the configured branch, or null if the ref/repo is empty. */
async function getRefSha(cfg: GitHubConfig): Promise<string | null> {
  try {
    const data = await gh<{ object: { sha: string } }>(
      cfg,
      "GET",
      `${repoPath(cfg)}/git/ref/heads/${cfg.branch}`,
    );
    return data.object.sha;
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null;
    throw e;
  }
}

export interface ConnectionInfo {
  defaultBranch: string;
  private: boolean;
  canPush: boolean;
  branchExists: boolean;
}

export async function testConnection(cfg: GitHubConfig): Promise<ConnectionInfo> {
  const repo = await gh<{
    default_branch: string;
    private: boolean;
    permissions?: { push?: boolean };
  }>(cfg, "GET", repoPath(cfg));
  const branchExists = (await getRefSha(cfg)) !== null;
  return {
    defaultBranch: repo.default_branch,
    private: repo.private,
    canPush: repo.permissions?.push ?? false,
    branchExists,
  };
}

export interface PushResult {
  commitSha: string;
  commitUrl: string;
}

/** Push the snapshot files as one atomic commit onto the configured branch. */
export async function pushFiles(
  cfg: GitHubConfig,
  files: SnapshotFile[],
  message: string,
): Promise<PushResult> {
  const base = repoPath(cfg);
  let baseSha = await getRefSha(cfg);

  // A repository with zero commits has no Git database yet, so the Git Data API
  // (blobs/trees/commits) replies 409 "Git Repository is empty." Initialise the
  // branch with one commit via the Contents API, then build the backup on it.
  // https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database
  if (baseSha === null) baseSha = await initBranch(cfg);

  const baseCommit = await gh<{ tree: { sha: string } }>(
    cfg,
    "GET",
    `${base}/git/commits/${baseSha}`,
  );
  const baseTreeSha = baseCommit.tree.sha;

  const tree = await Promise.all(
    files.map(async (f) => {
      const blob = await gh<{ sha: string }>(cfg, "POST", `${base}/git/blobs`, {
        content: f.content,
        encoding: "utf-8",
      });
      return {
        path: prefixed(cfg, f.path),
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      };
    }),
  );

  const newTree = await gh<{ sha: string }>(cfg, "POST", `${base}/git/trees`, {
    base_tree: baseTreeSha,
    tree,
  });

  const commit = await gh<{ sha: string; html_url: string }>(
    cfg,
    "POST",
    `${base}/git/commits`,
    { message, tree: newTree.sha, parents: [baseSha] },
  );

  try {
    await gh(cfg, "PATCH", `${base}/git/refs/heads/${cfg.branch}`, {
      sha: commit.sha,
      force: false,
    });
  } catch (e) {
    if (e instanceof GitHubError && e.status === 422)
      throw new GitHubError(
        "The remote branch moved since the backup was prepared — click Backup again.",
        422,
      );
    throw e;
  }

  return { commitSha: commit.sha, commitUrl: commit.html_url };
}

/**
 * Initialise an empty repository's branch with a single commit via the Contents
 * API, returning the new commit SHA. The Git Data API (blobs/trees/commits) 409s
 * on a repo with no commits, so the backup push needs a base commit to build on.
 */
async function initBranch(cfg: GitHubConfig): Promise<string> {
  const seedPath = prefixed(cfg, ".gitkeep");
  const urlPath = seedPath.split("/").map(encodeURIComponent).join("/");
  const res = await gh<{ commit: { sha: string } }>(
    cfg,
    "PUT",
    `${repoPath(cfg)}/contents/${urlPath}`,
    {
      message: "Initialize mcp-manage backup branch",
      content: Buffer.from("mcp-manage backups\n", "utf8").toString("base64"),
      branch: cfg.branch,
    },
  );
  return res.commit.sha;
}

const SNAPSHOT_FILE_RE = /^(manifest\.json|servers\.json|agents\.json|instructions\.md|subagents\/[^/]+\.md)$/;

export interface PullResult {
  files: Record<string, string>;
  commitSha: string;
}

/** Read the snapshot files back from the branch, or null if no backup exists. */
export async function pullFiles(cfg: GitHubConfig): Promise<PullResult | null> {
  const sha = await getRefSha(cfg);
  if (!sha) return null;
  const base = repoPath(cfg);

  const commit = await gh<{ tree: { sha: string } }>(
    cfg,
    "GET",
    `${base}/git/commits/${sha}`,
  );
  const tree = await gh<{
    tree: { path: string; type: string; sha: string }[];
    truncated: boolean;
  }>(cfg, "GET", `${base}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated)
    throw new GitHubError("Backup tree is too large to read in one request.", 422);

  const prefix = cfg.pathPrefix ? `${cfg.pathPrefix}/` : "";
  const wanted = tree.tree.filter(
    (e) =>
      e.type === "blob" &&
      e.path.startsWith(prefix) &&
      SNAPSHOT_FILE_RE.test(e.path.slice(prefix.length)),
  );

  const files: Record<string, string> = {};
  await Promise.all(
    wanted.map(async (e) => {
      const blob = await gh<{ content: string; encoding: string }>(
        cfg,
        "GET",
        `${base}/git/blobs/${e.sha}`,
      );
      files[e.path.slice(prefix.length)] =
        blob.encoding === "base64"
          ? Buffer.from(blob.content, "base64").toString("utf8")
          : blob.content;
    }),
  );

  return { files, commitSha: sha };
}
