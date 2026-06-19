// Serialize the managed state (the SQLite source of truth) into a portable,
// human-readable, git-diff-friendly set of files, and parse them back. The
// snapshot is built from loadState() — the same canonical in-memory state the
// sync engine uses — so a backup is exactly what the tool would write to agents.
import { buildFrontmatter, parseFrontmatter } from "../agents/frontmatter";
import { listAgentsMeta } from "../data";
import { loadState } from "../sync/engine";
import { AGENT_KEYS, type AgentKey, type Transport } from "../types";
import { redactServer, SECRET_SENTINEL } from "./redact";

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotServer {
  name: string;
  transport: Transport;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  targets: AgentKey[];
}

export interface SnapshotSubagent {
  name: string;
  description: string;
  prompt: string;
  model: string;
  tools: string[];
  color: string;
  enabled: boolean;
  targets: AgentKey[];
}

export interface SnapshotAgent {
  key: AgentKey;
  displayName: string;
  manageEnabled: boolean;
}

export interface Snapshot {
  schemaVersion: number;
  generatedAt: string;
  servers: SnapshotServer[];
  subagents: SnapshotSubagent[];
  instructions: string;
  agents: SnapshotAgent[];
}

export interface SnapshotFile {
  path: string;
  content: string;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Build a raw (un-redacted) snapshot from the database. */
export function buildSnapshot(): Snapshot {
  const st = loadState();
  const servers: SnapshotServer[] = st.servers
    .map((s) => ({ ...s.normalized, enabled: s.enabled, targets: s.targets }))
    .sort(byName);
  const subagents: SnapshotSubagent[] = st.subagents
    .map((s) => ({ ...s.normalized, enabled: s.enabled, targets: s.targets }))
    .sort(byName);
  const agents: SnapshotAgent[] = listAgentsMeta().map((a) => ({
    key: a.key,
    displayName: a.displayName,
    manageEnabled: a.manageEnabled,
  }));
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    servers,
    subagents,
    instructions: st.instructionsContent,
    agents,
  };
}

/** Redact secret values out of every server. Pure. */
export function redactSnapshot(snap: Snapshot): Snapshot {
  return { ...snap, servers: snap.servers.map(redactServer) };
}

const README = `# mcp-manage backup

This directory is an **automated backup** of [mcp-manage] state: MCP servers,
subagents, global instructions, and per-agent management toggles.

## Secrets are redacted

Secret values **never** leave your machine. Every \`env\` value and \`headers\`
value in \`servers.json\` is replaced with \`${SECRET_SENTINEL}\`, and
known token shapes / URL credentials in \`args\`/\`url\` are stripped too. The
keys are kept so you can see *which* secrets a server needs.

## Restore

Restore through the mcp-manage dashboard's GitHub panel. Restore is a
non-destructive merge: it never deletes local items, and it preserves any
secret values you already have locally. Servers restored onto a fresh machine
will have blank secret values for you to re-enter.

Do not hand-edit \`servers.json\` expecting redacted secrets to round-trip.
`;

/** Render a (typically redacted) snapshot into the repo file layout. */
export function renderSnapshotFiles(snap: Snapshot): SnapshotFile[] {
  const files: SnapshotFile[] = [];

  files.push({
    path: "manifest.json",
    content:
      JSON.stringify(
        {
          schemaVersion: snap.schemaVersion,
          generatedAt: snap.generatedAt,
          tool: "mcp-manage",
          counts: {
            servers: snap.servers.length,
            subagents: snap.subagents.length,
            agents: snap.agents.length,
          },
        },
        null,
        2,
      ) + "\n",
  });

  files.push({
    path: "servers.json",
    content: JSON.stringify(snap.servers, null, 2) + "\n",
  });

  files.push({
    path: "agents.json",
    content: JSON.stringify(snap.agents, null, 2) + "\n",
  });

  files.push({ path: "instructions.md", content: snap.instructions });

  for (const sa of snap.subagents) {
    files.push({
      path: `subagents/${sa.name}.md`,
      content: buildFrontmatter(
        {
          name: sa.name,
          description: sa.description,
          model: sa.model,
          tools: sa.tools,
          color: sa.color,
          enabled: sa.enabled,
          targets: sa.targets,
        },
        sa.prompt,
      ),
    });
  }

  files.push({ path: "README.md", content: README });

  return files;
}

// ---- parsing (restore) ----

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asBool(v: unknown, fallback = true): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function asTargets(v: unknown): AgentKey[] {
  return asStringArray(v).filter((k): k is AgentKey =>
    AGENT_KEYS.includes(k as AgentKey),
  );
}

/**
 * Reconstruct a Snapshot from repo file contents keyed by repo-relative path
 * (prefix already stripped). Throws if the manifest schema is newer than we
 * understand. Missing optional files default to empty.
 */
export function parseSnapshot(files: Record<string, string>): Snapshot {
  const manifestRaw = files["manifest.json"];
  let generatedAt = "";
  let schemaVersion = SNAPSHOT_SCHEMA_VERSION;
  if (manifestRaw) {
    try {
      const m = JSON.parse(manifestRaw) as {
        schemaVersion?: number;
        generatedAt?: string;
      };
      if (typeof m.schemaVersion === "number") schemaVersion = m.schemaVersion;
      generatedAt = asString(m.generatedAt);
    } catch {
      throw new Error("backup manifest.json is not valid JSON");
    }
  }
  if (schemaVersion > SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `backup was written by a newer mcp-manage (schema v${schemaVersion}); upgrade to restore it`,
    );
  }

  let servers: SnapshotServer[] = [];
  if (files["servers.json"]) {
    try {
      const arr = JSON.parse(files["servers.json"]) as SnapshotServer[];
      if (Array.isArray(arr)) servers = arr;
    } catch {
      throw new Error("backup servers.json is not valid JSON");
    }
  }

  let agents: SnapshotAgent[] = [];
  if (files["agents.json"]) {
    try {
      const arr = JSON.parse(files["agents.json"]) as SnapshotAgent[];
      if (Array.isArray(arr)) agents = arr.filter((a) => AGENT_KEYS.includes(a.key));
    } catch {
      // agents.json is non-critical; ignore a malformed one.
      agents = [];
    }
  }

  const subagents: SnapshotSubagent[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith("subagents/") || !path.endsWith(".md")) continue;
    const { data, body } = parseFrontmatter(content);
    const name = asString(data.name) || path.slice("subagents/".length, -3);
    if (!name) continue;
    subagents.push({
      name,
      description: asString(data.description),
      prompt: body.trim(),
      model: asString(data.model),
      tools: asStringArray(data.tools),
      color: asString(data.color),
      enabled: asBool(data.enabled),
      targets: asTargets(data.targets),
    });
  }

  return {
    schemaVersion,
    generatedAt,
    servers,
    subagents,
    instructions: files["instructions.md"] ?? "",
    agents,
  };
}
