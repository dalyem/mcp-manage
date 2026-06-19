import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import {
  agents,
  backups,
  instructions,
  mcpServers,
  serverTargets,
  skillFiles,
  skillTargets,
  skills,
  subagentTargets,
  subagents,
} from "./db/schema";
import {
  AGENT_KEYS,
  SKILL_AGENT_KEYS,
  type AgentKey,
  type Transport,
} from "./types";

export interface ServerInput {
  name: string;
  transport: Transport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  targets?: AgentKey[];
}

export interface ServerDTO {
  id: number;
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

const TRANSPORTS: Transport[] = ["stdio", "http", "sse"];

export function validateServerInput(input: ServerInput): string | null {
  if (!input.name || !/^[\w.-]+$/.test(input.name)) {
    return "name is required and may contain only letters, numbers, dot, dash, underscore";
  }
  if (!TRANSPORTS.includes(input.transport)) {
    return `transport must be one of ${TRANSPORTS.join(", ")}`;
  }
  if (input.transport === "stdio") {
    if (!input.command || input.command.trim() === "")
      return "stdio servers require a command";
  } else {
    if (!input.url || input.url.trim() === "")
      return `${input.transport} servers require a url`;
  }
  if (input.targets) {
    for (const t of input.targets) {
      if (!AGENT_KEYS.includes(t)) return `unknown target agent: ${t}`;
    }
  }
  return null;
}

function normalizeInput(input: ServerInput) {
  return {
    name: input.name.trim(),
    transport: input.transport,
    command: input.command?.trim() ?? "",
    args: input.args ?? [],
    env: input.env ?? {},
    url: input.url?.trim() ?? "",
    headers: input.headers ?? {},
    enabled: input.enabled ?? true,
  };
}

export function listServers(): ServerDTO[] {
  const rows = db.select().from(mcpServers).all();
  const targetRows = db.select().from(serverTargets).all();
  const byServer = new Map<number, AgentKey[]>();
  for (const t of targetRows) {
    const list = byServer.get(t.serverId) ?? [];
    list.push(t.agentKey as AgentKey);
    byServer.set(t.serverId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    transport: r.transport,
    command: r.command,
    args: r.args ?? [],
    env: r.env ?? {},
    url: r.url,
    headers: r.headers ?? {},
    enabled: r.enabled,
    targets: byServer.get(r.id) ?? [...AGENT_KEYS],
  }));
}

export function getServer(id: number): ServerDTO | null {
  return listServers().find((s) => s.id === id) ?? null;
}

function applyTargets(serverId: number, targets: AgentKey[] | undefined) {
  const list = targets ?? [...AGENT_KEYS];
  db.delete(serverTargets).where(eq(serverTargets.serverId, serverId)).run();
  for (const agentKey of list) {
    db.insert(serverTargets).values({ serverId, agentKey }).run();
  }
}

export function createServer(input: ServerInput): number {
  const v = normalizeInput(input);
  const res = db.insert(mcpServers).values(v).run();
  const id = Number(res.lastInsertRowid);
  applyTargets(id, input.targets);
  return id;
}

export function updateServer(id: number, input: ServerInput): void {
  const v = normalizeInput(input);
  db.update(mcpServers)
    .set({ ...v, updatedAt: new Date().toISOString() })
    .where(eq(mcpServers.id, id))
    .run();
  applyTargets(id, input.targets);
}

export function deleteServer(id: number): void {
  // server_targets cascade; managed_entries are cleaned up by the next sync
  // (the deleted server drops out of "desired", so owned-set cleanup removes it
  // from each agent file). We leave managed_entries intact so that cleanup runs.
  db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
}

export function setServerEnabled(id: number, enabled: boolean): void {
  db.update(mcpServers)
    .set({ enabled, updatedAt: new Date().toISOString() })
    .where(eq(mcpServers.id, id))
    .run();
}

// ---- Subagents ----

export interface SubagentInput {
  name: string;
  description?: string;
  prompt?: string;
  model?: string;
  tools?: string[];
  color?: string;
  enabled?: boolean;
  targets?: AgentKey[];
}

export interface SubagentDTO {
  id: number;
  name: string;
  description: string;
  prompt: string;
  model: string;
  tools: string[];
  color: string;
  enabled: boolean;
  targets: AgentKey[];
}

export function validateSubagentInput(input: SubagentInput): string | null {
  if (!input.name || !/^[a-z0-9][a-z0-9-]*$/.test(input.name)) {
    return "name is required and must be lowercase letters, numbers and dashes (e.g. code-reviewer)";
  }
  if (!input.description || input.description.trim() === "") {
    return "description is required (it tells the agent when to use this subagent)";
  }
  if (!input.prompt || input.prompt.trim() === "") {
    return "system prompt is required";
  }
  if (input.targets) {
    for (const t of input.targets) {
      if (!AGENT_KEYS.includes(t)) return `unknown target agent: ${t}`;
    }
  }
  return null;
}

function normalizeSubagentInput(input: SubagentInput) {
  return {
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    prompt: input.prompt ?? "",
    model: input.model?.trim() ?? "",
    tools: input.tools ?? [],
    color: input.color?.trim() ?? "",
    enabled: input.enabled ?? true,
  };
}

export function listSubagents(): SubagentDTO[] {
  const rows = db.select().from(subagents).all();
  const targetRows = db.select().from(subagentTargets).all();
  const byId = new Map<number, AgentKey[]>();
  for (const t of targetRows) {
    const list = byId.get(t.subagentId) ?? [];
    list.push(t.agentKey as AgentKey);
    byId.set(t.subagentId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    prompt: r.prompt,
    model: r.model,
    tools: r.tools ?? [],
    color: r.color,
    enabled: r.enabled,
    targets: byId.get(r.id) ?? [...AGENT_KEYS],
  }));
}

export function getSubagent(id: number): SubagentDTO | null {
  return listSubagents().find((s) => s.id === id) ?? null;
}

function applySubagentTargets(
  subagentId: number,
  targets: AgentKey[] | undefined,
) {
  const list = targets ?? [...AGENT_KEYS];
  db.delete(subagentTargets)
    .where(eq(subagentTargets.subagentId, subagentId))
    .run();
  for (const agentKey of list) {
    db.insert(subagentTargets).values({ subagentId, agentKey }).run();
  }
}

export function createSubagent(input: SubagentInput): number {
  const v = normalizeSubagentInput(input);
  const res = db.insert(subagents).values(v).run();
  const id = Number(res.lastInsertRowid);
  applySubagentTargets(id, input.targets);
  return id;
}

export function updateSubagent(id: number, input: SubagentInput): void {
  const v = normalizeSubagentInput(input);
  db.update(subagents)
    .set({ ...v, updatedAt: new Date().toISOString() })
    .where(eq(subagents.id, id))
    .run();
  applySubagentTargets(id, input.targets);
}

export function deleteSubagent(id: number): void {
  // subagent_targets cascade; managed_subagents are cleaned up by the next sync
  // (the deleted subagent drops out of "desired", so owned-set cleanup removes
  // its files from each agent dir). We leave managed_subagents intact for that.
  db.delete(subagents).where(eq(subagents.id, id)).run();
}

export function setSubagentEnabled(id: number, enabled: boolean): void {
  db.update(subagents)
    .set({ enabled, updatedAt: new Date().toISOString() })
    .where(eq(subagents.id, id))
    .run();
}

// ---- Skills ----

/** Caps on bundled-file size; content rides inline in every API payload and is
 *  stored in SQLite TEXT (base64 inflates binary ~33%). */
const MAX_SKILL_FILE_BYTES = 1024 * 1024; // 1 MB per bundled file
const MAX_SKILL_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB per skill (all files + body)

export interface SkillFileInput {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface SkillInput {
  name: string;
  description?: string;
  instructions?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
  files?: SkillFileInput[];
  enabled?: boolean;
  targets?: AgentKey[];
}

export interface SkillDTO {
  id: number;
  name: string;
  description: string;
  instructions: string;
  allowedTools: string[];
  metadata: Record<string, string>;
  files: { path: string; content: string; encoding: "utf8" | "base64" }[];
  enabled: boolean;
  targets: AgentKey[];
}

/** Strict base64 (after whitespace removal). Returns decoded byte length or null. */
function base64ByteLength(s: string): number | null {
  const b64 = s.replace(/\s/g, "");
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  return Buffer.from(b64, "base64").length;
}

/**
 * Validate one bundled-file path. THIS IS A SECURITY BOUNDARY: a bad path would
 * let a skill write files anywhere the server process can write. Reject absolute
 * paths, `..` traversal, backslashes, control chars and the reserved SKILL.md.
 */
function validateSkillFilePath(p: unknown): string | null {
  if (typeof p !== "string" || p.trim() === "") return "bundled file path is required";
  if (p !== p.trim()) return `file path must not have leading/trailing spaces: ${p}`;
  if (p === "SKILL.md") return "SKILL.md is generated from the skill fields, not a bundled file";
  if (p.includes("\\")) return `file path must use forward slashes: ${p}`;
  if (/[\u0000-\u001f\u007f]/.test(p)) return "file path must not contain control characters";
  if (path.posix.isAbsolute(p)) return `file path must be relative: ${p}`;
  const segments = p.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return `file path may not contain empty, "." or ".." segments: ${p}`;
  }
  // Defense in depth: the normalized path must stay inside the skill dir.
  const normalized = path.posix.normalize(p);
  if (
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    return `file path escapes the skill directory: ${p}`;
  }
  return null;
}

export function validateSkillInput(input: SkillInput): string | null {
  if (!input.name || !/^[a-z0-9][a-z0-9-]*$/.test(input.name)) {
    return "name is required and must be lowercase letters, numbers and dashes (e.g. pdf-tools)";
  }
  if (!input.description || input.description.trim() === "") {
    return "description is required (it tells the agent when to load this skill)";
  }
  if (!input.instructions || input.instructions.trim() === "") {
    return "instructions are required (they become the SKILL.md body)";
  }
  if (input.targets) {
    for (const t of input.targets) {
      if (!SKILL_AGENT_KEYS.includes(t as never)) {
        return AGENT_KEYS.includes(t)
          ? `skills are not supported for agent: ${t}`
          : `unknown target agent: ${t}`;
      }
    }
  }
  if (input.files) {
    let total = Buffer.byteLength(input.instructions, "utf8");
    const seen = new Set<string>();
    for (const f of input.files) {
      const pathErr = validateSkillFilePath(f.path);
      if (pathErr) return pathErr;
      if (seen.has(f.path)) return `duplicate bundled file path: ${f.path}`;
      seen.add(f.path);
      const encoding = f.encoding ?? "utf8";
      if (encoding !== "utf8" && encoding !== "base64") {
        return `file encoding must be "utf8" or "base64": ${f.path}`;
      }
      let bytes: number;
      if (encoding === "base64") {
        const len = base64ByteLength(f.content);
        if (len === null) return `bundled file is not valid base64: ${f.path}`;
        bytes = len;
      } else {
        bytes = Buffer.byteLength(f.content, "utf8");
      }
      if (bytes > MAX_SKILL_FILE_BYTES) {
        return `bundled file too large (max ${MAX_SKILL_FILE_BYTES} bytes): ${f.path}`;
      }
      total += bytes;
    }
    if (total > MAX_SKILL_TOTAL_BYTES) {
      return `skill too large (max ${MAX_SKILL_TOTAL_BYTES} bytes across all files)`;
    }
  }
  return null;
}

function normalizeSkillInput(input: SkillInput) {
  return {
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    instructions: input.instructions ?? "",
    allowedTools: input.allowedTools ?? [],
    metadata: input.metadata ?? {},
    enabled: input.enabled ?? true,
  };
}

export function listSkills(): SkillDTO[] {
  const rows = db.select().from(skills).all();
  const fileRows = db.select().from(skillFiles).all();
  const targetRows = db.select().from(skillTargets).all();

  const filesById = new Map<number, SkillDTO["files"]>();
  for (const f of fileRows) {
    const list = filesById.get(f.skillId) ?? [];
    list.push({ path: f.path, content: f.content, encoding: f.encoding });
    filesById.set(f.skillId, list);
  }
  const targetsById = new Map<number, AgentKey[]>();
  for (const t of targetRows) {
    const list = targetsById.get(t.skillId) ?? [];
    list.push(t.agentKey as AgentKey);
    targetsById.set(t.skillId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    allowedTools: r.allowedTools ?? [],
    metadata: r.metadata ?? {},
    files: (filesById.get(r.id) ?? []).sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
    enabled: r.enabled,
    // No explicit targets => default to every skills-capable agent.
    targets: targetsById.get(r.id) ?? [...SKILL_AGENT_KEYS],
  }));
}

export function getSkill(id: number): SkillDTO | null {
  return listSkills().find((s) => s.id === id) ?? null;
}

function applySkillTargets(skillId: number, targets: AgentKey[] | undefined) {
  const list = targets ?? [...SKILL_AGENT_KEYS];
  db.delete(skillTargets).where(eq(skillTargets.skillId, skillId)).run();
  for (const agentKey of list) {
    db.insert(skillTargets).values({ skillId, agentKey }).run();
  }
}

function applySkillFiles(skillId: number, files: SkillFileInput[] | undefined) {
  db.delete(skillFiles).where(eq(skillFiles.skillId, skillId)).run();
  for (const f of files ?? []) {
    db.insert(skillFiles)
      .values({
        skillId,
        path: f.path,
        content: f.content,
        encoding: f.encoding ?? "utf8",
      })
      .run();
  }
}

export function createSkill(input: SkillInput): number {
  const v = normalizeSkillInput(input);
  const res = db.insert(skills).values(v).run();
  const id = Number(res.lastInsertRowid);
  applySkillTargets(id, input.targets);
  applySkillFiles(id, input.files);
  return id;
}

export function updateSkill(id: number, input: SkillInput): void {
  const v = normalizeSkillInput(input);
  db.update(skills)
    .set({ ...v, updatedAt: new Date().toISOString() })
    .where(eq(skills.id, id))
    .run();
  applySkillTargets(id, input.targets);
  applySkillFiles(id, input.files);
}

export function deleteSkill(id: number): void {
  // skill_files + skill_targets cascade; managed_skills are cleaned up by the
  // next sync (the deleted skill drops out of "desired", so owned-set cleanup
  // removes its directory from each agent). We leave managed_skills intact.
  db.delete(skills).where(eq(skills.id, id)).run();
}

export function setSkillEnabled(id: number, enabled: boolean): void {
  db.update(skills)
    .set({ enabled, updatedAt: new Date().toISOString() })
    .where(eq(skills.id, id))
    .run();
}

export function getInstructions(): string {
  const row = db
    .select()
    .from(instructions)
    .where(eq(instructions.scope, "global"))
    .get();
  return row?.content ?? "";
}

export function setInstructions(content: string): void {
  db.insert(instructions)
    .values({ scope: "global", content, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: instructions.scope,
      set: { content, updatedAt: new Date().toISOString() },
    })
    .run();
}

export interface AgentMeta {
  key: AgentKey;
  displayName: string;
  manageEnabled: boolean;
}

export function listAgentsMeta(): AgentMeta[] {
  return db
    .select()
    .from(agents)
    .all()
    .map((a) => ({
      key: a.key as AgentKey,
      displayName: a.displayName,
      manageEnabled: a.manageEnabled,
    }));
}

export function setAgentManage(key: AgentKey, manageEnabled: boolean): void {
  db.update(agents)
    .set({ manageEnabled })
    .where(eq(agents.key, key))
    .run();
}

export interface BackupDTO {
  id: number;
  ts: string;
  agentKey: AgentKey;
  originalPath: string;
  backupPath: string;
  /** "file" = single-file backup; "dir" = a backed-up skill directory tree. */
  kind: "file" | "dir";
}

export function listBackups(limit = 50): BackupDTO[] {
  return db
    .select({
      id: backups.id,
      ts: backups.ts,
      agentKey: backups.agentKey,
      originalPath: backups.originalPath,
      backupPath: backups.backupPath,
      kind: backups.kind,
    })
    .from(backups)
    .all()
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, limit)
    .map((b) => ({ ...b, agentKey: b.agentKey as AgentKey }));
}
