import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { parse as parseToml } from "smol-toml";
import { db } from "../db/client";
import {
  agents,
  instructions,
  managedEntries,
  managedSubagents,
  mcpServers,
  serverTargets,
  subagentTargets,
  subagents,
  syncLog,
} from "../db/schema";
import { backupFile } from "../backup/backup";
import {
  isWritable,
  parseJsonc,
  readText,
  writeText,
  fileExists,
  removeFile,
} from "../fs-utils";
import { dirExists } from "../fs-utils";
import {
  ADAPTER_LIST,
  anyBinaryOnPath,
  type AgentAdapter,
} from "../agents";
import { ensureFirstRun } from "../import/first-run";
import {
  AGENT_KEYS,
  type AgentHealth,
  type AgentKey,
  type DriftState,
  type FileChange,
  type HealthLevel,
  type NormalizedServer,
  type NormalizedSubagent,
  type SyncKind,
  type SyncResult,
  type SyncStatus,
} from "../types";
import { lineDiff } from "./diff";
import { upsertManagedBlock } from "./managed-block";

interface ServerState {
  id: number;
  enabled: boolean;
  targets: AgentKey[];
  normalized: NormalizedServer;
}

interface SubagentState {
  id: number;
  enabled: boolean;
  targets: AgentKey[];
  normalized: NormalizedSubagent;
}

interface SyncState {
  servers: ServerState[];
  subagents: SubagentState[];
  instructionsContent: string;
  managed: Map<AgentKey, string[]>;
  managedSubagents: Map<AgentKey, string[]>;
  manageEnabled: Map<AgentKey, boolean>;
}

function rowToNormalized(r: typeof mcpServers.$inferSelect): NormalizedServer {
  return {
    name: r.name,
    transport: r.transport,
    command: r.command,
    args: r.args ?? [],
    env: r.env ?? {},
    url: r.url,
    headers: r.headers ?? {},
  };
}

function rowToNormalizedSubagent(
  r: typeof subagents.$inferSelect,
): NormalizedSubagent {
  return {
    name: r.name,
    description: r.description,
    prompt: r.prompt,
    model: r.model,
    tools: r.tools ?? [],
    color: r.color,
  };
}

export function loadState(): SyncState {
  const serverRows = db.select().from(mcpServers).all();
  const targetRows = db.select().from(serverTargets).all();
  const targetsByServer = new Map<number, AgentKey[]>();
  for (const t of targetRows) {
    const list = targetsByServer.get(t.serverId) ?? [];
    list.push(t.agentKey as AgentKey);
    targetsByServer.set(t.serverId, list);
  }

  const servers: ServerState[] = serverRows.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    // No explicit targets => default to all agents.
    targets: targetsByServer.get(r.id) ?? [...AGENT_KEYS],
    normalized: rowToNormalized(r),
  }));

  const managed = new Map<AgentKey, string[]>();
  for (const k of AGENT_KEYS) managed.set(k, []);
  for (const m of db.select().from(managedEntries).all()) {
    managed.get(m.agentKey as AgentKey)?.push(m.serverName);
  }

  const instrRow = db
    .select()
    .from(instructions)
    .where(eq(instructions.scope, "global"))
    .get();

  const subagentRows = db.select().from(subagents).all();
  const subagentTargetRows = db.select().from(subagentTargets).all();
  const subagentTargetsById = new Map<number, AgentKey[]>();
  for (const t of subagentTargetRows) {
    const list = subagentTargetsById.get(t.subagentId) ?? [];
    list.push(t.agentKey as AgentKey);
    subagentTargetsById.set(t.subagentId, list);
  }
  const subagentStates: SubagentState[] = subagentRows.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    targets: subagentTargetsById.get(r.id) ?? [...AGENT_KEYS],
    normalized: rowToNormalizedSubagent(r),
  }));

  const managedSubs = new Map<AgentKey, string[]>();
  for (const k of AGENT_KEYS) managedSubs.set(k, []);
  for (const m of db.select().from(managedSubagents).all()) {
    managedSubs.get(m.agentKey as AgentKey)?.push(m.name);
  }

  const manageEnabled = new Map<AgentKey, boolean>();
  for (const a of db.select().from(agents).all()) {
    manageEnabled.set(a.key as AgentKey, a.manageEnabled);
  }

  return {
    servers,
    subagents: subagentStates,
    instructionsContent: instrRow?.content ?? "",
    managed,
    managedSubagents: managedSubs,
    manageEnabled,
  };
}

function desiredFor(agentKey: AgentKey, state: SyncState): NormalizedServer[] {
  return state.servers
    .filter((s) => s.enabled && s.targets.includes(agentKey))
    .map((s) => s.normalized);
}

function desiredSubagentsFor(
  agentKey: AgentKey,
  state: SyncState,
): NormalizedSubagent[] {
  return state.subagents
    .filter((s) => s.enabled && s.targets.includes(agentKey))
    .map((s) => s.normalized);
}

interface SubagentFileChange {
  name: string;
  path: string;
  before: string | null;
  /** null => the file should be deleted */
  after: string | null;
  changed: boolean;
}

/**
 * Per-file plan for one agent's subagents: write each desired file (overwriting
 * drift), and delete any file we previously owned that's no longer desired.
 * Files we never owned are left untouched. Pure — no IO side effects.
 */
function computeSubagentChanges(
  adapter: AgentAdapter,
  desired: NormalizedSubagent[],
  owned: string[],
): SubagentFileChange[] {
  const fmt = adapter.subagents;
  const dir = adapter.agentsDir;
  if (!fmt || !dir) return [];

  const changes: SubagentFileChange[] = [];
  const desiredNames = new Set(desired.map((d) => d.name));

  for (const d of desired) {
    const p = path.join(dir, fmt.fileName(d.name));
    const before = readText(p);
    let after: string;
    try {
      after = fmt.build(d);
    } catch {
      continue;
    }
    changes.push({
      name: d.name,
      path: p,
      before,
      after,
      changed: after !== before,
    });
  }

  // Owned files no longer desired (deleted / disabled / un-targeted) => remove.
  for (const name of owned) {
    if (desiredNames.has(name)) continue;
    const p = path.join(dir, fmt.fileName(name));
    const before = readText(p);
    if (before !== null) {
      changes.push({ name, path: p, before, after: null, changed: true });
    }
  }

  return changes;
}

function configParsesOk(adapter: AgentAdapter, content: string | null): boolean {
  if (content == null || content.trim() === "") return true;
  if (adapter.key === "codex") {
    try {
      parseToml(content);
      return true;
    } catch {
      return false;
    }
  }
  return parseJsonc(content) !== null;
}

function computeServerChange(
  adapter: AgentAdapter,
  desired: NormalizedServer[],
  owned: string[],
): FileChange {
  const before = readText(adapter.configPath);
  // Never create an empty config file for an agent that has nothing to manage.
  if (before === null && desired.length === 0) {
    return { path: adapter.configPath, before, after: "", changed: false };
  }
  try {
    const after = adapter.buildServersFile(before, desired, owned);
    return { path: adapter.configPath, before, after, changed: after !== before };
  } catch (e) {
    return {
      path: adapter.configPath,
      before,
      after: before ?? "",
      changed: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function computeInstrChange(
  adapter: AgentAdapter,
  content: string,
): FileChange | null {
  if (!adapter.instructionsPath) return null;
  const before = readText(adapter.instructionsPath);
  if (before === null && content.trim() === "") {
    return { path: adapter.instructionsPath, before, after: "", changed: false };
  }
  const after = upsertManagedBlock(before, content);
  return {
    path: adapter.instructionsPath,
    before,
    after,
    changed: after !== before,
  };
}

export interface AgentInspection {
  adapter: AgentAdapter;
  present: boolean;
  manageEnabled: boolean;
  health: AgentHealth;
  serverChange: FileChange;
  instrChange: FileChange | null;
  subagentChanges: SubagentFileChange[];
}

/** Read-only: compute changes once and derive health from them. */
function inspectAgent(adapter: AgentAdapter, state: SyncState): AgentInspection {
  const key = adapter.key;
  const manageEnabled = state.manageEnabled.get(key) ?? true;
  const binaryOnPath = anyBinaryOnPath(adapter.binaries);
  const configDirExists = dirExists(adapter.configDir);
  const configExists = fileExists(adapter.configPath);
  const present = binaryOnPath || configExists || configDirExists;

  const content = readText(adapter.configPath);
  const configParses = configParsesOk(adapter, content);
  const configWritable = isWritable(adapter.configPath);
  const instructionsSupported = adapter.instructionsPath !== null;
  const instructionsWritable = instructionsSupported
    ? isWritable(adapter.instructionsPath as string)
    : false;

  const desired = desiredFor(key, state);
  const owned = state.managed.get(key) ?? [];
  const serverChange = computeServerChange(adapter, desired, owned);
  const instrChange = computeInstrChange(adapter, state.instructionsContent);
  const subagentChanges = computeSubagentChanges(
    adapter,
    desiredSubagentsFor(key, state),
    state.managedSubagents.get(key) ?? [],
  );

  let drift: DriftState = "unknown";
  if (present && configParses) {
    const driftedServers = serverChange.changed && !serverChange.error;
    const driftedInstr = !!instrChange?.changed;
    const driftedSubagents = subagentChanges.some((c) => c.changed);
    drift =
      driftedServers || driftedInstr || driftedSubagents
        ? "drifted"
        : "in-sync";
  }

  const last = db
    .select()
    .from(syncLog)
    .where(and(eq(syncLog.agentKey, key), eq(syncLog.kind, "servers")))
    .orderBy(desc(syncLog.ts))
    .limit(1)
    .get();

  const messages: string[] = [];
  let level: HealthLevel = "ok";
  if (!present) {
    messages.push("not installed");
  } else if (manageEnabled) {
    if (!configParses) {
      level = "error";
      messages.push("config file does not parse");
    } else if (!configWritable) {
      level = "error";
      messages.push("config file not writable");
    } else if (drift === "drifted") {
      level = "warn";
      messages.push("out of sync — re-sync needed");
    }
    if (instructionsSupported && !instructionsWritable) {
      if (level !== "error") level = "warn";
      messages.push("instruction file not writable");
    }
    if (!instructionsSupported && state.instructionsContent.trim() !== "") {
      if (level === "ok") level = "warn";
      messages.push("global instructions unsupported (Cursor rules are UI-only)");
    }
  }
  if (!manageEnabled) messages.push("management disabled");

  const health: AgentHealth = {
    key,
    displayName: adapter.displayName,
    manageEnabled,
    present,
    binaryOnPath,
    configDirExists,
    configPath: adapter.configPath,
    configExists,
    configParses,
    configWritable,
    instructionsSupported,
    instructionsPath: adapter.instructionsPath,
    instructionsWritable,
    drift,
    lastSync: last?.ts ?? null,
    lastSyncStatus: (last?.status as SyncStatus) ?? null,
    level,
    messages,
  };

  return {
    adapter,
    present,
    manageEnabled,
    health,
    serverChange,
    instrChange,
    subagentChanges,
  };
}

function setManaged(agentKey: AgentKey, names: string[]): void {
  db.transaction((tx) => {
    tx.delete(managedEntries).where(eq(managedEntries.agentKey, agentKey)).run();
    for (const name of names) {
      tx.insert(managedEntries).values({ agentKey, serverName: name }).run();
    }
  });
}

function setManagedSubagents(agentKey: AgentKey, names: string[]): void {
  db.transaction((tx) => {
    tx.delete(managedSubagents)
      .where(eq(managedSubagents.agentKey, agentKey))
      .run();
    for (const name of names) {
      tx.insert(managedSubagents).values({ agentKey, name }).run();
    }
  });
}

function logSync(
  agentKey: AgentKey,
  kind: SyncKind,
  status: SyncStatus,
  message: string,
  diff?: string,
): void {
  db.insert(syncLog)
    .values({ agentKey, kind, status, message, diff: diff ?? null })
    .run();
}

export interface SyncOptions {
  dryRun?: boolean;
  /** Only sync these agents (default: all). */
  only?: AgentKey[];
}

export function syncAll(opts: SyncOptions = {}): SyncResult[] {
  ensureFirstRun();
  const dryRun = opts.dryRun ?? false;
  const state = loadState();
  const results: SyncResult[] = [];

  for (const adapter of ADAPTER_LIST) {
    if (opts.only && !opts.only.includes(adapter.key)) continue;
    const ins = inspectAgent(adapter, state);
    const key = adapter.key;

    if (!ins.manageEnabled) {
      results.push(skip(key, "servers", "management disabled"));
      continue;
    }
    if (!ins.present) {
      results.push(skip(key, "servers", "agent not installed"));
      continue;
    }

    // --- servers ---
    const sc = ins.serverChange;
    if (sc.error) {
      results.push({
        agentKey: key,
        kind: "servers",
        status: "error",
        changed: false,
        message: sc.error,
        path: sc.path,
      });
      if (!dryRun) logSync(key, "servers", "error", sc.error);
    } else {
      const diff = sc.changed ? lineDiff(sc.before, sc.after) : undefined;
      let backupPath: string | undefined;
      if (!dryRun) {
        if (sc.changed) {
          backupPath = backupFile(key, sc.path) ?? undefined;
          writeText(sc.path, sc.after);
        }
        // The owned-set always reflects current desired names after a sync.
        setManaged(
          key,
          desiredFor(key, state).map((d) => d.name),
        );
        if (sc.changed) logSync(key, "servers", "ok", "updated", diff);
      }
      results.push({
        agentKey: key,
        kind: "servers",
        status: "ok",
        changed: sc.changed,
        message: sc.changed
          ? dryRun
            ? "would update"
            : "updated"
          : "up to date",
        diff,
        backupPath,
        path: sc.path,
      });
    }

    // --- instructions ---
    if (ins.instrChange) {
      const ic = ins.instrChange;
      const diff = ic.changed ? lineDiff(ic.before, ic.after) : undefined;
      let backupPath: string | undefined;
      if (!dryRun && ic.changed) {
        backupPath = backupFile(key, ic.path) ?? undefined;
        writeText(ic.path, ic.after);
        logSync(key, "instructions", "ok", "updated", diff);
      }
      results.push({
        agentKey: key,
        kind: "instructions",
        status: "ok",
        changed: ic.changed,
        message: ic.changed
          ? dryRun
            ? "would update"
            : "updated"
          : "up to date",
        diff,
        backupPath,
        path: ic.path,
      });
    } else if (state.instructionsContent.trim() !== "") {
      results.push(
        skip(
          key,
          "instructions",
          "global instructions not file-manageable (UI-only rules)",
        ),
      );
    }

    // --- subagents ---
    for (const sc of ins.subagentChanges) {
      if (!sc.changed) continue;
      const isDelete = sc.after === null;
      const diff = lineDiff(sc.before, sc.after ?? "");
      let backupPath: string | undefined;
      if (!dryRun) {
        if (sc.before !== null) backupPath = backupFile(key, sc.path) ?? undefined;
        if (isDelete) removeFile(sc.path);
        else writeText(sc.path, sc.after as string);
        logSync(
          key,
          "subagents",
          "ok",
          `${isDelete ? "removed" : "updated"} ${sc.name}`,
          diff,
        );
      }
      results.push({
        agentKey: key,
        kind: "subagents",
        status: "ok",
        changed: true,
        message: `${dryRun ? "would " : ""}${
          isDelete ? "remove" : "update"
        } ${sc.name}`,
        diff,
        backupPath,
        path: sc.path,
      });
    }
    // After syncing, the owned-set reflects the current desired subagent names.
    if (!dryRun && adapter.subagents) {
      setManagedSubagents(
        key,
        desiredSubagentsFor(key, state).map((d) => d.name),
      );
    }
  }

  return results;
}

export interface AgentStatus extends AgentHealth {
  pendingServers: { path: string; diff: string } | null;
  pendingInstructions: { path: string; diff: string } | null;
  pendingSubagents: {
    name: string;
    path: string;
    diff: string;
    deleted: boolean;
  }[];
}

export function getStatus(): AgentStatus[] {
  ensureFirstRun();
  const state = loadState();
  return ADAPTER_LIST.map((adapter) => {
    const ins = inspectAgent(adapter, state);
    return {
      ...ins.health,
      pendingServers:
        ins.serverChange.changed && !ins.serverChange.error
          ? {
              path: ins.serverChange.path,
              diff: lineDiff(ins.serverChange.before, ins.serverChange.after),
            }
          : null,
      pendingInstructions: ins.instrChange?.changed
        ? {
            path: ins.instrChange.path,
            diff: lineDiff(ins.instrChange.before, ins.instrChange.after),
          }
        : null,
      pendingSubagents: ins.subagentChanges
        .filter((c) => c.changed)
        .map((c) => ({
          name: c.name,
          path: c.path,
          diff: lineDiff(c.before, c.after ?? ""),
          deleted: c.after === null,
        })),
    };
  });
}

function skip(
  agentKey: AgentKey,
  kind: "servers" | "instructions",
  message: string,
): SyncResult {
  return { agentKey, kind, status: "skipped", changed: false, message };
}
