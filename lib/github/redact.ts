// Strip secret VALUES out of a server before it is pushed to GitHub. The goal is
// that no credential ever leaves the machine while the STRUCTURE (which env vars
// / headers a server needs) is preserved so the backup stays useful.
//
// Guarantees:
//   - env values:     ALWAYS fully redacted (exhaustive), keys kept.
//   - headers values: ALWAYS fully redacted (exhaustive), keys kept.
//   - args / url:      best-effort — known secret-bearing flags and well-known
//                      token shapes / URL credentials are redacted. This is
//                      defense-in-depth, not a guarantee; restore previews flag
//                      any server whose args/url still contain the sentinel.
import type { NormalizedServer } from "../types";

export const SECRET_SENTINEL = "__MCP_MANAGE_REDACTED__";

export function isSentinel(v: string): boolean {
  return v === SECRET_SENTINEL;
}

/** Flag names whose accompanying value should be treated as a secret. */
const SECRET_FLAG_RE =
  /(api[-_]?key|access[-_]?key|secret|token|password|passwd|pwd|auth|bearer|credential|private[-_]?key)/i;

/** Well-known credential shapes that can be redacted wherever they appear. */
const TOKEN_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub classic tokens
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWTs
];

/** Query-string parameter names whose value is a secret. */
const SECRET_QUERY_RE =
  /^(api[-_]?key|access[-_]?token|token|key|secret|password|auth)$/i;

function redactKnownTokens(value: string): string {
  let out = value;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, SECRET_SENTINEL);
  return out;
}

function redactArgs(args: string[]): string[] {
  const out: string[] = [];
  let redactNext = false;
  for (const raw of args) {
    if (redactNext) {
      out.push(SECRET_SENTINEL);
      redactNext = false;
      continue;
    }
    // `--api-key=VALUE` → keep the flag, redact the value.
    const eq = raw.indexOf("=");
    if (raw.startsWith("-") && eq !== -1) {
      const flag = raw.slice(0, eq);
      if (SECRET_FLAG_RE.test(flag)) {
        out.push(`${flag}=${SECRET_SENTINEL}`);
        continue;
      }
    }
    // `--api-key VALUE` (value is the next array element).
    if (raw.startsWith("-") && eq === -1 && SECRET_FLAG_RE.test(raw)) {
      out.push(raw);
      redactNext = true;
      continue;
    }
    out.push(redactKnownTokens(raw));
  }
  return out;
}

function redactUrl(url: string): string {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a parseable URL — fall back to token-shape redaction only.
    return redactKnownTokens(url);
  }
  if (parsed.username || parsed.password) {
    parsed.username = parsed.password ? SECRET_SENTINEL : "";
    parsed.password = parsed.password ? SECRET_SENTINEL : "";
  }
  for (const [key] of parsed.searchParams) {
    if (SECRET_QUERY_RE.test(key)) parsed.searchParams.set(key, SECRET_SENTINEL);
  }
  return parsed.toString();
}

function redactRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(rec)) out[key] = SECRET_SENTINEL;
  return out;
}

/** Return a redacted copy of a server. Pure — does not mutate the input. */
export function redactServer<T extends NormalizedServer>(s: T): T {
  return {
    ...s,
    args: redactArgs(s.args ?? []),
    env: redactRecord(s.env ?? {}),
    url: redactUrl(s.url ?? ""),
    headers: redactRecord(s.headers ?? {}),
  };
}
