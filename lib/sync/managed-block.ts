// Manages a delimited block inside markdown instruction files so the tool can
// own a section without clobbering the user's own notes above/below it.

export const BLOCK_BEGIN = "<!-- BEGIN mcp-manage -->";
export const BLOCK_END = "<!-- END mcp-manage -->";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BLOCK_RE = new RegExp(
  `${escapeRegExp(BLOCK_BEGIN)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}`,
);

/**
 * Insert or replace the managed block. Empty content removes the block. User
 * content outside the markers is preserved. Returns the new file content (or ""
 * when the file would be empty).
 */
export function upsertManagedBlock(
  existing: string | null,
  content: string,
): string {
  const base = existing ?? "";
  const body = content.trim();
  const block = `${BLOCK_BEGIN}\n${body}\n${BLOCK_END}`;

  if (BLOCK_RE.test(base)) {
    if (body === "") {
      const stripped = base
        .replace(BLOCK_RE, "")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();
      return stripped === "" ? "" : stripped + "\n";
    }
    return base.replace(BLOCK_RE, block).trimEnd() + "\n";
  }

  // No existing managed block.
  if (body === "") return base; // nothing to add, leave file as-is
  if (base.trim() === "") return block + "\n";
  return base.replace(/\n*$/, "") + "\n\n" + block + "\n";
}

export function extractManagedBlock(existing: string | null): string | null {
  if (!existing) return null;
  const m = existing.match(BLOCK_RE);
  if (!m) return null;
  return m[0]
    .replace(BLOCK_BEGIN, "")
    .replace(BLOCK_END, "")
    .trim();
}
