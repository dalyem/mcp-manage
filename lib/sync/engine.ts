import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { parse as parseToml } from "smol-toml";
import { db } from "../db/client";
import {
  agents,
  instructions,
  managedEntries,
  managedSkills,
  managedSubagents,
  mcpServers,
  serverTargets,
  skillFiles,
  skillTargets,
  skills,
  subagentTargets,
  subagents,
  syncLog,
} from "../db/schema";
import { backupFile, backupSkillDir } from "../backup/backup";
import {
  isWritable,
  parseJsonc,
  readText,
  writeText,
  fileExists,
  removeFile,
  listFilesRecursive,
  readBytes,
  removeEmptyDirs,
  writeBytes,
} from "../fs-utils";
import { dirExists } from "../fs-utils";
import { buildSkillMd, SKILL_FILE } from "../agents/skill-format";
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
  type NormalizedSkill,
  type NormalizedSubagent,
  SKILL_AGENT_KEYS,
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

interface SkillState {
  id: number;
  enabled: boolean;
  targets: AgentKey[];
  normalized: NormalizedSkill;
}

interface SyncState {
  servers: ServerState[];
  subagents: SubagentState[];
  skills: SkillState[];
  instructionsContent: string;
  managed: Map<AgentKey, string[]>;
  managedSubagents: Map<AgentKey, string[]>;
  managedSkills: Map<AgentKey, string[]>;
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

function rowToNormalizedSkill(
  r: typeof skills.$inferSelect,
  files: NormalizedSkill["files"],
): NormalizedSkill {
  return {
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    allowedTools: r.allowedTools ?? [],
    metadata: r.metadata ?? {},
    files,
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

  const skillRows = db.select().from(skills).all();
  const skillFileRows = db.select().from(skillFiles).all();
  const skillFilesById = new Map<number, NormalizedSkill["files"]>();
  for (const f of skillFileRows) {
    const list = skillFilesById.get(f.skillId) ?? [];
    list.push({ path: f.path, content: f.content, encoding: f.encoding });
    skillFilesById.set(f.skillId, list);
  }
  const skillTargetRows = db.select().from(skillTargets).all();
  const skillTargetsById = new Map<number, AgentKey[]>();
  for (const t of skillTargetRows) {
    const list = skillTargetsById.get(t.skillId) ?? [];
    list.push(t.agentKey as AgentKey);
    skillTargetsById.set(t.skillId, list);
  }
  const skillStates: SkillState[] = skillRows.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    targets: skillTargetsById.get(r.id) ?? [...SKILL_AGENT_KEYS],
    normalized: rowToNormalizedSkill(r, skillFilesById.get(r.id) ?? []),
  }));

  const managedSkillsMap = new Map<AgentKey, string[]>();
  for (const k of AGENT_KEYS) managedSkillsMap.set(k, []);
  for (const m of db.select().from(managedSkills).all()) {
    managedSkillsMap.get(m.agentKey as AgentKey)?.push(m.name);
  }

  const manageEnabled = new Map<AgentKey, boolean>();
  for (const a of db.select().from(agents).all()) {
    manageEnabled.set(a.key as AgentKey, a.manageEnabled);
  }

  return {
    servers,
    subagents: subagentStates,
    skills: skillStates,
    instructionsContent: instrRow?.content ?? "",
    managed,
    managedSubagents: managedSubs,
    managedSkills: managedSkillsMap,
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

function desiredSkillsFor(
  agentKey: AgentKey,
  state: SyncState,
): NormalizedSkill[] {
  return state.skills
    .filter((s) => s.enabled && s.targets.includes(agentKey))
    .map((s) => s.normalized);
}

interface DesiredFile {
  content: string;
  encoding: "utf8" | "base64";
}

/** The full desired file tree for one skill: SKILL.md plus its bundled files. */
function desiredSkillTree(skill: NormalizedSkill): Map<string, DesiredFile> {
  const tree = new Map<string, DesiredFile>();
  tree.set(SKILL_FILE, { content: buildSkillMd(skill), encoding: "utf8" });
  for (const f of skill.files) {
    tree.set(f.path, { content: f.content, encoding: f.encoding });
  }
  return tree;
}

interface SkillFileOp {
  relPath: string;
  absPath: string;
  kind: "write" | "delete";
  encoding: "utf8" | "base64";
  /** desired content to write (utf8 text or base64); "" for a delete. */
  content: string;
  /** before/after text for diffing (utf8 only; null for binary or absent). */
  before: string | null;
  after: string | null;
  changed: boolean;
}

interface SkillChange {
  name: string;
  /** the skill directory: <skillsDir>/<name>. */
  dir: string;
  ops: SkillFileOp[];
  /** the whole skill was deleted / disabled / un-targeted. */
  removeDir: boolean;
  changed: boolean;
}

/** Absolute path for a POSIX-relative file path under a skill directory. */
function skillFileAbs(dir: string, relPath: string): string {
  return path.join(dir, ...relPath.split("/"));
}

/**
 * Per-directory plan for one agent's skills. For each desired skill, mirror its
 * file tree under <skillsDir>/<name> (write SKILL.md + bundled files, delete any
 * stale file we previously owned in that tree). For each owned skill no longer
 * desired, remove its whole directory. Pure — only reads from disk.
 */
function computeSkillChanges(
  adapter: AgentAdapter,
  desired: NormalizedSkill[],
  owned: string[],
): SkillChange[] {
  const skillsDir = adapter.skillsDir;
  if (!skillsDir) return [];

  const changes: SkillChange[] = [];
  const desiredNames = new Set(desired.map((d) => d.name));
  const ownedNames = new Set(owned);

  for (const skill of desired) {
    const dir = path.join(skillsDir, skill.name);
    const tree = desiredSkillTree(skill);
    const ops: SkillFileOp[] = [];

    for (const [relPath, want] of tree) {
      const absPath = skillFileAbs(dir, relPath);
      if (want.encoding === "utf8") {
        const before = readText(absPath);
        ops.push({
          relPath,
          absPath,
          kind: "write",
          encoding: "utf8",
          content: want.content,
          before,
          after: want.content,
          changed: want.content !== before,
        });
      } else {
        const desiredBytes = Buffer.from(want.content, "base64");
        const beforeBytes = readBytes(absPath);
        ops.push({
          relPath,
          absPath,
          kind: "write",
          encoding: "base64",
          content: want.content,
          before: null,
          after: null,
          changed: !beforeBytes || !beforeBytes.equals(desiredBytes),
        });
      }
    }

    // Prune stale files only under skill dirs we already own — never on a
    // skill's first sync. The owned-set is recorded only AFTER a successful
    // sync, so a brand-new skill is absent here on its first pass; pruning it
    // would delete a pre-existing user directory's files on name collision.
    if (ownedNames.has(skill.name)) {
      for (const relPath of listFilesRecursive(dir)) {
        if (tree.has(relPath)) continue;
        const absPath = skillFileAbs(dir, relPath);
        ops.push({
          relPath,
          absPath,
          kind: "delete",
          encoding: "utf8",
          content: "",
          before: readText(absPath),
          after: null,
          changed: true,
        });
      }
    }

    changes.push({
      name: skill.name,
      dir,
      ops,
      removeDir: false,
      changed: ops.some((o) => o.changed),
    });
  }

  // Owned skills no longer desired (deleted / disabled / un-targeted) => remove.
  for (const name of owned) {
    if (desiredNames.has(name)) continue;
    const dir = path.join(skillsDir, name);
    const ops: SkillFileOp[] = listFilesRecursive(dir).map((relPath) => ({
      relPath,
      absPath: skillFileAbs(dir, relPath),
      kind: "delete" as const,
      encoding: "utf8" as const,
      content: "",
      before: readText(skillFileAbs(dir, relPath)),
      after: null,
      changed: true,
    }));
    if (ops.length > 0) {
      changes.push({ name, dir, ops, removeDir: true, changed: true });
    }
  }

  return changes;
}

/** Render a multi-file skill change as a labeled, concatenated diff. */
function skillDiff(change: SkillChange): string {
  const blocks: string[] = [];
  for (const op of change.ops) {
    if (!op.changed) continue;
    if (op.encoding === "base64") {
      blocks.push(
        `${op.relPath}\n${
          op.kind === "delete" ? "- (binary file removed)" : "+ (binary file)"
        }`,
      );
    } else {
      blocks.push(`${op.relPath}\n${lineDiff(op.before ?? "", op.after ?? "")}`);
    }
  }
  return blocks.join("\n\n");
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
  skillChanges: SkillChange[];
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
  const skillChanges = computeSkillChanges(
    adapter,
    desiredSkillsFor(key, state),
    state.managedSkills.get(key) ?? [],
  );

  let drift: DriftState = "unknown";
  if (present && configParses) {
    const driftedServers = serverChange.changed && !serverChange.error;
    const driftedInstr = !!instrChange?.changed;
    const driftedSubagents = subagentChanges.some((c) => c.changed);
    const driftedSkills = skillChanges.some((c) => c.changed);
    drift =
      driftedServers || driftedInstr || driftedSubagents || driftedSkills
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
    skillChanges,
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

function setManagedSkills(agentKey: AgentKey, names: string[]): void {
  db.transaction((tx) => {
    tx.delete(managedSkills).where(eq(managedSkills.agentKey, agentKey)).run();
    for (const name of names) {
      tx.insert(managedSkills).values({ agentKey, name }).run();
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

    // --- skills ---
    // Captured into a local so the non-null narrowing survives the IO calls
    // below (TS drops property narrowing across function calls).
    const skillsDir = adapter.skillsDir;
    if (skillsDir) {
      for (const skc of ins.skillChanges) {
        if (!skc.changed) continue;
        const diff = skillDiff(skc);
        let backupPath: string | undefined;
        if (!dryRun) {
          // Back up the whole skill dir before any write/delete touches it.
          backupPath = backupSkillDir(key, skc.dir) ?? undefined;
          for (const op of skc.ops) {
            if (!op.changed) continue;
            if (op.kind === "delete") {
              removeFile(op.absPath);
              // Prune the file's now-empty parent dirs up to (not incl.) the
              // skills root — cleans emptied subdirs and the whole skill dir.
              removeEmptyDirs(path.dirname(op.absPath), skillsDir);
            } else if (op.encoding === "base64") {
              writeBytes(op.absPath, Buffer.from(op.content, "base64"));
            } else {
              writeText(op.absPath, op.content);
            }
          }
          logSync(
            key,
            "skills",
            "ok",
            `${skc.removeDir ? "removed" : "updated"} ${skc.name}`,
            diff,
          );
        }
        results.push({
          agentKey: key,
          kind: "skills",
          status: "ok",
          changed: true,
          message: `${dryRun ? "would " : ""}${
            skc.removeDir ? "remove" : "update"
          } ${skc.name}`,
          diff,
          backupPath,
          path: skc.dir,
        });
      }
      // After syncing, the owned-set reflects the current desired skill names.
      if (!dryRun) {
        setManagedSkills(
          key,
          desiredSkillsFor(key, state).map((d) => d.name),
        );
      }
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
  pendingSkills: {
    name: string;
    dir: string;
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
      pendingSkills: ins.skillChanges
        .filter((c) => c.changed)
        .map((c) => ({
          name: c.name,
          dir: c.dir,
          diff: skillDiff(c),
          deleted: c.removeDir,
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
