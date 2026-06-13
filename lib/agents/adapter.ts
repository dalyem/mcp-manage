import type { AgentKey, NormalizedServer } from "../types";

/**
 * An adapter knows how to read and write one agent's MCP config file. Adapters
 * are PURE transforms over file content (string in -> string out); all IO,
 * backups, diffing and DB bookkeeping live in the sync engine. This keeps the
 * tricky per-agent format logic isolated and easy to test.
 */
export interface AgentAdapter {
  key: AgentKey;
  displayName: string;
  /** Absolute path to the agent's global MCP config file. */
  configPath: string;
  /** Absolute path to the agent's global instruction file, or null if none. */
  instructionsPath: string | null;
  /** Binary names to look for on PATH when detecting installation. */
  binaries: string[];
  /** A directory whose existence also implies the agent is present. */
  configDir: string;

  /** Parse current config text into normalized servers (import + drift). */
  parseServers(currentContent: string | null): NormalizedServer[];

  /**
   * Produce the full new config-file content. `desired` is the set of servers
   * that should exist for this agent (already filtered to enabled + targeted);
   * `owned` is the set of server names we previously wrote (so stale ones are
   * removed). Everything else in the file is preserved untouched.
   */
  buildServersFile(
    currentContent: string | null,
    desired: NormalizedServer[],
    owned: string[],
  ): string;
}

/** Drop empty object/array fields to keep generated files tidy. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)
      continue;
    out[k] = v;
  }
  return out as T;
}
