import fs from "node:fs";
import path from "node:path";

export function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function ensureDirFor(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

export function writeText(p: string, content: string): void {
  ensureDirFor(p);
  fs.writeFileSync(p, content, "utf8");
}

/**
 * Is the path writable, or (if it doesn't exist) is its parent directory
 * writable so we could create it?
 */
export function isWritable(p: string): boolean {
  try {
    if (fs.existsSync(p)) {
      fs.accessSync(p, fs.constants.W_OK);
      return true;
    }
    // Walk up to the nearest existing ancestor and check that.
    let dir = path.dirname(p);
    while (!fs.existsSync(dir)) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Names of the regular files directly inside `dir` ([] if it doesn't exist). */
export function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Delete a file if it exists; no-op (and never throws) if it doesn't. */
export function removeFile(p: string): void {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // best-effort: a missing file is success; anything else is surfaced by the
    // next drift check rather than crashing a sync.
  }
}

/**
 * Every regular file under `dir`, recursively, as POSIX-relative paths (using
 * "/" separators to match skill_files.path). Returns [] if `dir` is absent.
 */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(childAbs, childRel);
      else if (e.isFile()) out.push(childRel);
    }
  };
  walk(dir, "");
  return out;
}

/** Read a file as raw bytes, or null if it can't be read. */
export function readBytes(p: string): Buffer | null {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/** Write raw bytes, creating parent directories as needed. */
export function writeBytes(p: string, data: Buffer): void {
  ensureDirFor(p);
  fs.writeFileSync(p, data);
}

/**
 * Remove `dir` and any parent dirs that become empty, climbing UP but never to
 * or past `stopAt`. Best-effort; never throws. Used to prune an emptied skill
 * directory (and empty nested subdirs) after its files are deleted.
 */
export function removeEmptyDirs(dir: string, stopAt: string): void {
  let cur = path.resolve(dir);
  const stop = path.resolve(stopAt);
  while (cur !== stop && cur.startsWith(stop + path.sep)) {
    try {
      fs.rmdirSync(cur); // succeeds only when the directory is empty
    } catch {
      break; // not empty (or already gone) — stop climbing
    }
    cur = path.dirname(cur);
  }
}

/**
 * Conservatively strip comments from JSONC so we can parse files like
 * opencode.json that allow `//` and `/* *\/` comments. We only remove
 * whole-line `//` comments (first non-whitespace is `//`) and block
 * comments, so URLs containing `//` inside string values are preserved.
 */
export function stripJsonc(text: string): string {
  // Remove /* ... */ block comments.
  let out = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove whole-line // comments.
  out = out
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return out;
}

export function parseJsonc<T = unknown>(text: string | null): T | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    try {
      return JSON.parse(stripJsonc(trimmed)) as T;
    } catch {
      return null;
    }
  }
}
