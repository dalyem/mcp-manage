import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { Transport } from "../types";

export const mcpServers = sqliteTable("mcp_servers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  transport: text("transport").$type<Transport>().notNull().default("stdio"),
  command: text("command").notNull().default(""),
  args: text("args", { mode: "json" }).$type<string[]>().notNull().default([]),
  env: text("env", { mode: "json" })
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  url: text("url").notNull().default(""),
  headers: text("headers", { mode: "json" })
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const agents = sqliteTable("agents", {
  key: text("key").primaryKey(),
  displayName: text("display_name").notNull(),
  manageEnabled: integer("manage_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
});

export const serverTargets = sqliteTable(
  "server_targets",
  {
    serverId: integer("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    agentKey: text("agent_key").notNull(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.agentKey] })],
);

/** The "owned set": server names this tool last wrote into each agent's file. */
export const managedEntries = sqliteTable(
  "managed_entries",
  {
    agentKey: text("agent_key").notNull(),
    serverName: text("server_name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentKey, t.serverName] })],
);

export const instructions = sqliteTable("instructions", {
  scope: text("scope").primaryKey().default("global"),
  content: text("content").notNull().default(""),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts")
    .notNull()
    .default(sql`(datetime('now'))`),
  agentKey: text("agent_key").notNull(),
  kind: text("kind").notNull().default("servers"),
  status: text("status").notNull(),
  message: text("message").notNull().default(""),
  diff: text("diff"),
});

export const backups = sqliteTable("backups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts")
    .notNull()
    .default(sql`(datetime('now'))`),
  agentKey: text("agent_key").notNull(),
  originalPath: text("original_path").notNull(),
  content: text("content"),
  backupPath: text("backup_path").notNull(),
});

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});
