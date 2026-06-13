// Minimal LCS-based line diff for the dry-run preview. Produces a compact
// +/- listing; only ever runs on files that actually changed.

export function lineDiff(before: string | null, after: string): string {
  const a = (before ?? "").split("\n");
  const b = after.split("\n");

  // LCS table.
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < m) lines.push(`- ${a[i++]}`);
  while (j < n) lines.push(`+ ${b[j++]}`);

  // Collapse long runs of unchanged context so huge files (e.g. ~/.claude.json)
  // don't drown the changed region.
  return collapseContext(lines, 3);
}

function collapseContext(lines: string[], ctx: number): string {
  const keep = new Array(lines.length).fill(false);
  for (let k = 0; k < lines.length; k++) {
    if (lines[k][0] === "+" || lines[k][0] === "-") {
      for (let d = -ctx; d <= ctx; d++) {
        const idx = k + d;
        if (idx >= 0 && idx < lines.length) keep[idx] = true;
      }
    }
  }
  const out: string[] = [];
  let skipping = false;
  for (let k = 0; k < lines.length; k++) {
    if (keep[k]) {
      out.push(lines[k]);
      skipping = false;
    } else if (!skipping) {
      out.push("  …");
      skipping = true;
    }
  }
  return out.join("\n");
}
