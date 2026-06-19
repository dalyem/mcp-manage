import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { HOME } from "../paths";
import type { NormalizedServer } from "../types";
import { compact, type AgentAdapter } from "./adapter";
import { tomlSubagentFormat } from "./subagent-format";
import {
  asStringArray,
  asStringRecord,
  emptyServer,
  resolveTarget,
  stableEqual,
} from "./json-helpers";

// Codex CLI: ~/.codex/config.toml (TOML!) holding model/approvals/projects/etc.
// MCP servers live under [mcp_servers.NAME]. Remote uses `url` + `http_headers`.
// We read-modify-write only the `mcp_servers` table; comments are not preserved
// by the TOML serializer, which is why every write is backed up first.
const MCP_KEY = "mcp_servers";

function toEntry(s: NormalizedServer): Record<string, unknown> {
  if (s.transport === "stdio") {
    return compact({ command: s.command, args: s.args, env: s.env });
  }
  return compact({ url: s.url, http_headers: s.headers });
}

function fromEntry(name: string, e: Record<string, unknown>): NormalizedServer {
  const s = emptyServer(name);
  if (typeof e.command === "string" && !e.url) {
    s.transport = "stdio";
    s.command = e.command;
    s.args = asStringArray(e.args);
    s.env = asStringRecord(e.env);
  } else if (typeof e.url === "string") {
    s.transport = "http";
    s.url = e.url;
    s.headers = asStringRecord(e.http_headers);
  }
  return s;
}

function parseRoot(content: string | null): Record<string, unknown> {
  if (!content || content.trim() === "") return {};
  try {
    return parseToml(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const codexAdapter: AgentAdapter = {
  key: "codex",
  displayName: "Codex CLI",
  configPath: path.join(HOME, ".codex", "config.toml"),
  instructionsPath: path.join(HOME, ".codex", "AGENTS.md"),
  binaries: ["codex"],
  configDir: path.join(HOME, ".codex"),
  agentsDir: path.join(HOME, ".codex", "agents"),
  subagents: tomlSubagentFormat(),
  skillsDir: path.join(HOME, ".codex", "skills"),
  parseServers(content) {
    const root = parseRoot(content);
    const servers = root[MCP_KEY];
    if (!servers || typeof servers !== "object" || Array.isArray(servers))
      return [];
    return Object.entries(servers as Record<string, unknown>).map(([name, e]) =>
      fromEntry(name, (e ?? {}) as Record<string, unknown>),
    );
  },
  buildServersFile(content, desired, owned) {
    const root = parseRoot(content);
    const existingRaw = root[MCP_KEY];
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
      servers[s.name] = toEntry(s);
    }

    const target = resolveTarget(servers, existing, owned);

    // No-op when the MCP region is unchanged — preserves the user's TOML
    // formatting and comments (smol-toml would otherwise reformat the file).
    if (stableEqual(existing, target)) {
      return content ?? "";
    }

    if (target === undefined) delete root[MCP_KEY];
    else root[MCP_KEY] = target;
    return stringifyToml(root) + "\n";
  },
};
