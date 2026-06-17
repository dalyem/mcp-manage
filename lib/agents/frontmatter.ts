// Build/parse YAML frontmatter for markdown agent files (subagents). We emit a
// small, known set of scalar/list fields, but parse with a real YAML parser so
// hand-edited files (arbitrary frontmatter) round-trip safely.
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Serialize `data` as a frontmatter block followed by the markdown body. */
export function buildFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  const yaml = stringifyYaml(data).trimEnd();
  const head = `---\n${yaml}\n---`;
  const trimmed = body.trim();
  return trimmed ? `${head}\n\n${trimmed}\n` : `${head}\n`;
}

/** Split a markdown file into its frontmatter data and the remaining body. */
export function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: content };
  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }
  return { data, body: content.slice(m[0].length) };
}
