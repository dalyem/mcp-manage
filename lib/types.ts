// Shared domain types for mcp-manage.

export const AGENT_KEYS = [
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

/**
 * Agents that support the SKILL.md Agent Skills standard. Every agent except
 * Gemini CLI (which has no skill concept). Must match the adapters whose
 * `skillsDir` is non-null.
 */
export const SKILL_AGENT_KEYS = AGENT_KEYS.filter(
  (k) => k !== "gemini",
) as Exclude<AgentKey, "gemini">[];

export type SkillAgentKey = (typeof SKILL_AGENT_KEYS)[number];

export type Transport = "stdio" | "http" | "sse";

/**
 * The normalized, agent-agnostic representation of an MCP server. Each adapter
 * translates this into its agent's concrete on-disk shape.
 */
export interface NormalizedServer {
  name: string;
  transport: Transport;
  /** stdio only */
  command: string;
  /** stdio only */
  args: string[];
  /** stdio only (env vars set for the child process) */
  env: Record<string, string>;
  /** http/sse only */
  url: string;
  /** http/sse only */
  headers: Record<string, string>;
}

/**
 * The normalized, agent-agnostic representation of a custom subagent. Each
 * adapter translates this into its agent's concrete on-disk file (markdown +
 * YAML frontmatter for most; TOML for Codex). The markdown body / TOML
 * `developer_instructions` field carries `prompt`.
 */
export interface NormalizedSubagent {
  name: string;
  /** when the agent should delegate to this subagent */
  description: string;
  /** the system prompt (file body) */
  prompt: string;
  /** model override; "" = inherit each agent's default */
  model: string;
  /** tool allowlist; [] = inherit all. Applied best-effort per agent. */
  tools: string[];
  /** optional UI color; "" = none */
  color: string;
}

/**
 * One bundled file that travels alongside SKILL.md inside a skill directory.
 * `path` is POSIX-style and relative to the skill dir (e.g. "scripts/run.py");
 * binary files are carried base64-encoded.
 */
export interface SkillFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
}

/**
 * The normalized, agent-agnostic representation of an Agent Skill. Unlike a
 * subagent (one file), a skill is a DIRECTORY: a generated SKILL.md (frontmatter
 * + the `instructions` body) plus any bundled `files`. The SKILL.md format is
 * shared across every skills-capable agent, so there is no per-agent skill
 * format — only a per-agent skills directory (AgentAdapter.skillsDir).
 */
export interface NormalizedSkill {
  name: string;
  /** when the agent should load this skill (SKILL.md `description`) */
  description: string;
  /** the SKILL.md markdown body (the instructions) */
  instructions: string;
  /** optional frontmatter `allowed-tools`; [] = omit */
  allowedTools: string[];
  /** optional passthrough frontmatter `metadata`; {} = omit */
  metadata: Record<string, string>;
  /** bundled files beside SKILL.md */
  files: SkillFile[];
}

export type SyncStatus = "ok" | "skipped" | "error";
export type SyncKind = "servers" | "instructions" | "subagents" | "skills";

export interface SyncResult {
  agentKey: AgentKey;
  kind: SyncKind;
  status: SyncStatus;
  /** human-readable summary */
  message: string;
  /** whether the file content actually changed */
  changed: boolean;
  /** unified-ish text diff of before -> after (when changed) */
  diff?: string;
  /** path to the backup taken before writing, if any */
  backupPath?: string;
  /** the file this result concerns */
  path?: string | null;
}

export type HealthLevel = "ok" | "warn" | "error";
export type DriftState = "in-sync" | "drifted" | "unknown";

export interface AgentHealth {
  key: AgentKey;
  displayName: string;
  /** managed by the tool (manage_enabled in DB) */
  manageEnabled: boolean;
  /** installed = binary on PATH OR config dir/file exists */
  present: boolean;
  binaryOnPath: boolean;
  configDirExists: boolean;
  configPath: string;
  configExists: boolean;
  configParses: boolean;
  configWritable: boolean;
  instructionsSupported: boolean;
  instructionsPath: string | null;
  instructionsWritable: boolean;
  /** does the on-disk state match what a sync would produce? */
  drift: DriftState;
  lastSync: string | null;
  lastSyncStatus: SyncStatus | null;
  level: HealthLevel;
  messages: string[];
}

/** Result of computing (without necessarily writing) a single file's next state. */
export interface FileChange {
  path: string;
  before: string | null;
  after: string;
  changed: boolean;
  error?: string;
}
