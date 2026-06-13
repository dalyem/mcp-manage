// Shared domain types for mcp-manage.

export const AGENT_KEYS = [
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

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

export type SyncStatus = "ok" | "skipped" | "error";
export type SyncKind = "servers" | "instructions";

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
