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

// Cursor: ~/.cursor/mcp.json (dedicated file). Remote servers OMIT `type`
// (transport is inferred from the URL). Global *rules* are UI-only, so there is
// no instructions file path here.
const MCP_KEY = "mcpServers";

function toEntry(s: NormalizedServer): Record<string, unknown> {
  if (s.transport === "stdio") {
    return compact({ command: s.command, args: s.args, env: s.env });
  }
  return compact({ url: s.url, headers: s.headers });
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

export const cursorAdapter: AgentAdapter = {
  key: "cursor",
  displayName: "Cursor CLI",
  configPath: path.join(HOME, ".cursor", "mcp.json"),
  instructionsPath: null, // global rules are UI-only — not file-manageable
  binaries: ["cursor-agent", "cursor"],
  configDir: path.join(HOME, ".cursor"),
  parseServers: (c) => parseJsonServers(c, { mcpKey: MCP_KEY, fromEntry }),
  buildServersFile: (c, desired, owned) =>
    buildJsonServersFile(c, desired, owned, { mcpKey: MCP_KEY, toEntry, fromEntry }),
};
