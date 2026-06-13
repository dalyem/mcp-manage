import path from "node:path";
import { HOME } from "../paths";
import type { NormalizedServer } from "../types";
import { compact, type AgentAdapter } from "./adapter";
import {
  asStringArray,
  asStringRecord,
  buildJsonServersFile,
  emptyServer,
  parseJsonServers,
} from "./json-helpers";

// Claude Code: ~/.claude.json (huge state file) — only the top-level
// "mcpServers" key is ever touched. Remote servers REQUIRE a `type` field.
const MCP_KEY = "mcpServers";

function toEntry(s: NormalizedServer): Record<string, unknown> {
  if (s.transport === "stdio") {
    return compact({
      type: "stdio",
      command: s.command,
      args: s.args,
      env: s.env,
    });
  }
  return compact({
    type: s.transport, // "http" | "sse"
    url: s.url,
    headers: s.headers,
  });
}

function fromEntry(name: string, e: Record<string, unknown>): NormalizedServer {
  const s = emptyServer(name);
  if (typeof e.command === "string" && !e.url) {
    s.transport = "stdio";
    s.command = e.command;
    s.args = asStringArray(e.args);
    s.env = asStringRecord(e.env);
  } else if (typeof e.url === "string") {
    s.transport = e.type === "sse" ? "sse" : "http";
    s.url = e.url;
    s.headers = asStringRecord(e.headers);
  }
  return s;
}

export const claudeAdapter: AgentAdapter = {
  key: "claude",
  displayName: "Claude Code",
  configPath: path.join(HOME, ".claude.json"),
  instructionsPath: path.join(HOME, ".claude", "CLAUDE.md"),
  binaries: ["claude"],
  configDir: path.join(HOME, ".claude"),
  parseServers: (c) => parseJsonServers(c, { mcpKey: MCP_KEY, fromEntry }),
  buildServersFile: (c, desired, owned) =>
    buildJsonServersFile(c, desired, owned, { mcpKey: MCP_KEY, toEntry, fromEntry }),
};
