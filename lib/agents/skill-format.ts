// Pure (de)serializers for SKILL.md — the cross-agent Agent Skills format.
//
// A skill is a DIRECTORY; SKILL.md is its manifest: YAML frontmatter (name,
// description, optional `allowed-tools` / `metadata`) followed by a markdown
// body (the instructions). Unlike subagents, this format is identical across
// every skills-capable agent (Claude, Codex, OpenCode, Cursor), so a single
// serializer serves all of them — the only per-agent difference is the skills
// directory (AgentAdapter.skillsDir). The engine owns directory listing, IO,
// deletes and backups; this only (de)serializes the SKILL.md file content.
import type { NormalizedSkill } from "../types";
import { compact } from "./adapter";
import { buildFrontmatter, parseFrontmatter } from "./frontmatter";

/** The generated manifest file at the root of every skill directory. */
export const SKILL_FILE = "SKILL.md";

/** allowed-tools may arrive as a YAML array or a comma/newline-separated string. */
function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string")
    return v
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function strRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val == null) continue;
    out[k] = typeof val === "string" ? val : String(val);
  }
  return out;
}

/** Serialize a normalized skill into SKILL.md content (frontmatter + body). */
export function buildSkillMd(skill: NormalizedSkill): string {
  const fields: Record<string, unknown> = compact({
    name: skill.name || undefined,
    description: skill.description || undefined,
    "allowed-tools":
      skill.allowedTools.length > 0 ? skill.allowedTools.join(", ") : undefined,
    metadata:
      Object.keys(skill.metadata).length > 0 ? skill.metadata : undefined,
  });
  return buildFrontmatter(fields, skill.instructions);
}

/**
 * Parse SKILL.md content back into skill fields (the name comes from the
 * directory, not the frontmatter). Provided for symmetry / future import.
 */
export function parseSkillMd(
  content: string,
): Pick<
  NormalizedSkill,
  "description" | "instructions" | "allowedTools" | "metadata"
> {
  const { data, body } = parseFrontmatter(content);
  return {
    description: typeof data.description === "string" ? data.description : "",
    instructions: body.trim(),
    allowedTools: parseList(data["allowed-tools"]),
    metadata: strRecord(data.metadata),
  };
}
