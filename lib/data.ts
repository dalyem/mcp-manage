import { eq } from "drizzle-orm";
import { db } from "./db/client";
import {
  agents,
  backups,
  instructions,
  mcpServers,
  serverTargets,
} from "./db/schema";
import {
  AGENT_KEYS,
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
}

export function listBackups(limit = 50): BackupDTO[] {
  return db
    .select({
      id: backups.id,
      ts: backups.ts,
      agentKey: backups.agentKey,
      originalPath: backups.originalPath,
      backupPath: backups.backupPath,
    })
    .from(backups)
    .all()
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, limit)
    .map((b) => ({ ...b, agentKey: b.agentKey as AgentKey }));
}
