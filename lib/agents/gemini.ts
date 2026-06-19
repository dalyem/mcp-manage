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

// Gemini CLI: ~/.gemini/settings.json (nested "v2" sections) — only the root
// "mcpServers" key is touched. Streamable HTTP uses `httpUrl`; SSE uses `url`.
const MCP_KEY = "mcpServers";

function toEntry(s: NormalizedServer): Record<string, unknown> {
  if (s.transport === "stdio") {
    return compact({ command: s.command, args: s.args, env: s.env });
  }
  if (s.transport === "http") {
    return compact({ httpUrl: s.url, headers: s.headers });
  }
  return compact({ url: s.url, headers: s.headers }); // sse
}

function fromEntry(name: string, e: Record<string, unknown>): NormalizedServer {
  const s = emptyServer(name);
  if (typeof e.command === "string") {
    s.transport = "stdio";
    s.command = e.command;
    s.args = asStringArray(e.args);
    s.env = asStringRecord(e.env);
  } else if (typeof e.httpUrl === "string") {
    s.transport = "http";
    s.url = e.httpUrl;
    s.headers = asStringRecord(e.headers);
  } else if (typeof e.url === "string") {
    s.transport = "sse";
    s.url = e.url;
    s.headers = asStringRecord(e.headers);
  }
  return s;
}

export const geminiAdapter: AgentAdapter = {
  key: "gemini",
  displayName: "Gemini CLI",
  configPath: path.join(HOME, ".gemini", "settings.json"),
  instructionsPath: path.join(HOME, ".gemini", "GEMINI.md"),
  binaries: ["gemini"],
  configDir: path.join(HOME, ".gemini"),
  agentsDir: path.join(HOME, ".gemini", "agents"),
  subagents: mdSubagentFormat({ emitName: true, tools: "array" }),
  skillsDir: null, // Gemini CLI has no Agent Skills concept (commands only)
  parseServers: (c) => parseJsonServers(c, { mcpKey: MCP_KEY, fromEntry }),
  buildServersFile: (c, desired, owned) =>
    buildJsonServersFile(c, desired, owned, { mcpKey: MCP_KEY, toEntry, fromEntry }),
};
