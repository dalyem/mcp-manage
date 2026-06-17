// Per-agent subagent (file) serializers. Like the MCP entry transforms, these
// are PURE: one NormalizedSubagent <-> one file's content. Directory listing,
// reads/writes, deletes, backups and DB bookkeeping all live in the sync engine.
//
// Four of the five agents use markdown + YAML frontmatter with the system prompt
// as the body (Claude, Cursor, Gemini, OpenCode); Codex is the outlier and uses
// TOML with the prompt in a `developer_instructions` field.
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { NormalizedSubagent } from "../types";
import { compact, type SubagentFormat } from "./adapter";
import { buildFrontmatter, parseFrontmatter } from "./frontmatter";

export function emptySubagent(name: string): NormalizedSubagent {
  return { name, description: "", prompt: "", model: "", tools: [], color: "" };
}

/** Tools may arrive as a YAML/TOML array or a comma/space-separated string. */
function parseTools(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string")
    return v
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface MdOptions {
  /** Emit an explicit `name:` field (Claude/Gemini/Cursor); else name = filename. */
  emitName: boolean;
  /** Serialize the tool allowlist as CSV / YAML array, or omit it ("none"). */
  tools: "csv" | "array" | "none";
  /** Constant extra frontmatter (e.g. OpenCode's `mode: subagent`). */
  extra?: Record<string, unknown>;
}

/** Markdown + YAML frontmatter subagent format (body = system prompt). */
export function mdSubagentFormat(opts: MdOptions): SubagentFormat {
  return {
    fileName: (name) => `${name}.md`,
    nameFromFile: (file) => (file.endsWith(".md") ? file.slice(0, -3) : null),
    build(sa) {
      const tools =
        opts.tools === "none" || sa.tools.length === 0
          ? undefined
          : opts.tools === "csv"
            ? sa.tools.join(", ")
            : sa.tools;
      const fields: Record<string, unknown> = {
        name: opts.emitName ? sa.name || undefined : undefined,
        description: sa.description || undefined,
        ...(opts.extra ?? {}),
        model: sa.model || undefined,
        tools,
        color: sa.color || undefined,
      };
      return buildFrontmatter(compact(fields), sa.prompt);
    },
    parse(name, content) {
      const { data, body } = parseFrontmatter(content);
      const sa = emptySubagent(name);
      if (opts.emitName && str(data.name).trim()) sa.name = str(data.name).trim();
      sa.description = str(data.description);
      sa.model = str(data.model);
      sa.tools = opts.tools === "none" ? [] : parseTools(data.tools);
      sa.color = str(data.color);
      sa.prompt = body.trim();
      return sa;
    },
  };
}

/** Codex TOML subagent format (prompt lives in `developer_instructions`). */
export function tomlSubagentFormat(): SubagentFormat {
  return {
    fileName: (name) => `${name}.toml`,
    nameFromFile: (file) =>
      file.endsWith(".toml") ? file.slice(0, -5) : null,
    build(sa) {
      const fields: Record<string, unknown> = compact({
        name: sa.name || undefined,
        description: sa.description || undefined,
        model: sa.model || undefined,
        developer_instructions: sa.prompt || undefined,
      });
      return stringifyToml(fields) + "\n";
    },
    parse(name, content) {
      const sa = emptySubagent(name);
      let root: Record<string, unknown> = {};
      try {
        root = parseToml(content) as Record<string, unknown>;
      } catch {
        root = {};
      }
      if (str(root.name).trim()) sa.name = str(root.name).trim();
      sa.description = str(root.description);
      sa.model = str(root.model);
      sa.prompt = str(root.developer_instructions);
      return sa;
    },
  };
}
