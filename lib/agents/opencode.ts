import path from "node:path";
import { HOME } from "../paths";
import type { NormalizedServer } from "../types";
import { compact, type AgentAdapter } from "./adapter";
import { mdSubagentFormat } from "./subagent-format";
import {
  asStringArray,
  asStringRecord,
  buildJsonServersFile,
  emptyServer,
  parseJsonServers,
} from "./json-helpers";

// OpenCode: ~/.config/opencode/opencode.json — distinct shape. Local servers
// use type:"local" with `command` as a single ARRAY and `environment`; remote
// servers use type:"remote" with `url`. Both carry an `enabled` flag.
const MCP_KEY = "mcp";

function toEntry(s: NormalizedServer): Record<string, unknown> {
  if (s.transport === "stdio") {
    return compact({
      type: "local",
      command: [s.command, ...s.args].filter((x) => x !== ""),
      environment: s.env,
      enabled: true,
    });
  }
  return compact({
    type: "remote",
    url: s.url,
    headers: s.headers,
    enabled: true,
  });
}

function fromEntry(name: string, e: Record<string, unknown>): NormalizedServer {
  const s = emptyServer(name);
  const isLocal = e.type === "local" || Array.isArray(e.command);
  if (isLocal) {
    const cmd = asStringArray(e.command);
    s.transport = "stdio";
    s.command = cmd[0] ?? "";
    s.args = cmd.slice(1);
    s.env = asStringRecord(e.environment);
  } else if (typeof e.url === "string") {
    s.transport = "http";
    s.url = e.url;
    s.headers = asStringRecord(e.headers);
  }
  return s;
}

export const opencodeAdapter: AgentAdapter = {
  key: "opencode",
  displayName: "OpenCode",
  configPath: path.join(HOME, ".config", "opencode", "opencode.json"),
  instructionsPath: path.join(HOME, ".config", "opencode", "AGENTS.md"),
  binaries: ["opencode"],
  configDir: path.join(HOME, ".config", "opencode"),
  // OpenCode derives the agent name from the filename (no `name` field) and
  // marks subagents with `mode: subagent`; tool perms don't map to an allowlist.
  agentsDir: path.join(HOME, ".config", "opencode", "agents"),
  subagents: mdSubagentFormat({
    emitName: false,
    tools: "none",
    extra: { mode: "subagent" },
  }),
  skillsDir: path.join(HOME, ".config", "opencode", "skills"),
  parseServers: (c) => parseJsonServers(c, { mcpKey: MCP_KEY, fromEntry }),
  buildServersFile: (c, desired, owned) =>
    buildJsonServersFile(c, desired, owned, {
      mcpKey: MCP_KEY,
      toEntry,
      fromEntry,
      extraDefaults: { $schema: "https://opencode.ai/config.json" },
    }),
};
