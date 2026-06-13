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
