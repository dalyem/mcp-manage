import { parseJsonc } from "../fs-utils";
import type { NormalizedServer } from "../types";

type Entry = Record<string, unknown>;

interface JsonShape {
  /** Top-level key holding the server map (e.g. "mcpServers" or "mcp"). */
  mcpKey: string;
  /** Serialize one normalized server into this agent's entry shape. */
  toEntry: (s: NormalizedServer) => Entry;
  /** Parse one agent entry back into a normalized server. */
  fromEntry: (name: string, entry: Entry) => NormalizedServer;
  /** Extra top-level keys to add only when absent (e.g. opencode "$schema"). */
  extraDefaults?: Record<string, unknown>;
  indent?: number;
}

/**
 * Surgical read-modify-write for JSON-config agents. Reads the current file,
 * upserts the desired servers, removes owned-but-no-longer-desired servers, and
 * leaves every other key (and every non-owned server) untouched.
 *
 * Critically, this is a NO-OP when the managed server region is unchanged: it
 * returns the original content verbatim so we never churn (or reformat) a file
 * that doesn't need a change. We only re-serialize when servers actually move.
 */
export function buildJsonServersFile(
  currentContent: string | null,
  desired: NormalizedServer[],
  owned: string[],
  shape: JsonShape,
): string {
  const root = (parseJsonc<Record<string, unknown>>(currentContent) ??
    {}) as Record<string, unknown>;

  const existingRaw = root[shape.mcpKey];
  const existing: Record<string, unknown> | undefined =
    existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
      ? (existingRaw as Record<string, unknown>)
      : undefined;

  const servers: Record<string, unknown> = { ...(existing ?? {}) };
  const desiredNames = new Set(desired.map((s) => s.name));
  for (const name of owned) {
    if (!desiredNames.has(name)) delete servers[name];
  }
  for (const s of desired) {
    servers[s.name] = shape.toEntry(s);
  }

  const target = resolveTarget(servers, existing, owned);

  if (stableEqual(existing, target)) {
    return currentContent ?? "";
  }

  if (target === undefined) delete root[shape.mcpKey];
  else root[shape.mcpKey] = target;

  // Extra defaults (e.g. opencode "$schema") are only added when we're already
  // writing — never on their own — so they can't trigger spurious drift.
  if (shape.extraDefaults) {
    for (const [k, v] of Object.entries(shape.extraDefaults)) {
      if (!(k in root)) root[k] = v;
    }
  }

  return JSON.stringify(root, null, shape.indent ?? 2) + "\n";
}

export function parseJsonServers(
  currentContent: string | null,
  shape: Pick<JsonShape, "mcpKey" | "fromEntry">,
): NormalizedServer[] {
  const root = parseJsonc<Record<string, unknown>>(currentContent);
  if (!root) return [];
  const servers = root[shape.mcpKey];
  if (!servers || typeof servers !== "object" || Array.isArray(servers))
    return [];
  return Object.entries(servers as Record<string, unknown>).map(([name, e]) =>
    shape.fromEntry(name, (e ?? {}) as Entry),
  );
}

/** Shared helpers for normalizing common entry fields. */
export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

export function asStringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = String(val);
  }
  return out;
}

/**
 * Decide the final value for the MCP key:
 * - non-empty -> the server map
 * - empty because WE removed our owned entries -> undefined (delete the key, clean uninstall)
 * - empty and we never owned anything -> leave whatever was there (don't add or
 *   remove a key the user controls; avoids false drift on a user's empty key)
 */
export function resolveTarget(
  servers: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  owned: string[],
): Record<string, unknown> | undefined {
  if (Object.keys(servers).length > 0) return servers;
  if (owned.length > 0) return undefined;
  return existing;
}

/** Order-insensitive structural equality (for change detection). */
export function stableEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

export function emptyServer(name: string): NormalizedServer {
  return {
    name,
    transport: "stdio",
    command: "",
    args: [],
    env: {},
    url: "",
    headers: {},
  };
}
