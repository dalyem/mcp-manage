import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { DB_PATH, ensureDataDirs } from "../paths";
import { AGENT_KEYS, type AgentKey } from "../types";

const AGENT_DISPLAY: Record<AgentKey, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  cursor: "Cursor CLI",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};

/**
 * Self-bootstrapping schema. We deliberately use idempotent CREATE TABLE IF
 * NOT EXISTS rather than file-based migrations so the always-on service comes
 * up cleanly with no separate migrate step. The Drizzle schema in schema.ts is
 * the source of truth for typed queries and must stay in sync with this DDL.
 */
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL DEFAULT 'stdio',
  command TEXT NOT NULL DEFAULT '',
  args TEXT NOT NULL DEFAULT '[]',
  env TEXT NOT NULL DEFAULT '{}',
  url TEXT NOT NULL DEFAULT '',
  headers TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subagents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  manage_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS server_targets (
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  PRIMARY KEY (server_id, agent_key)
);

CREATE TABLE IF NOT EXISTS managed_entries (
  agent_key TEXT NOT NULL,
  server_name TEXT NOT NULL,
  PRIMARY KEY (agent_key, server_name)
);

CREATE TABLE IF NOT EXISTS subagent_targets (
  subagent_id INTEGER NOT NULL REFERENCES subagents(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  PRIMARY KEY (subagent_id, agent_key)
);

CREATE TABLE IF NOT EXISTS managed_subagents (
  agent_key TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (agent_key, name)
);

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  encoding TEXT NOT NULL DEFAULT 'utf8',
  UNIQUE (skill_id, path)
);

CREATE TABLE IF NOT EXISTS skill_targets (
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  PRIMARY KEY (skill_id, agent_key)
);

CREATE TABLE IF NOT EXISTS managed_skills (
  agent_key TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (agent_key, name)
);

CREATE TABLE IF NOT EXISTS instructions (
  scope TEXT PRIMARY KEY DEFAULT 'global',
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  agent_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'servers',
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  diff TEXT
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  agent_key TEXT NOT NULL,
  original_path TEXT NOT NULL,
  content TEXT,
  backup_path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file'
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

function bootstrap(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(BOOTSTRAP_SQL);

  // Additive column migrations for DBs created before the column existed.
  // CREATE TABLE IF NOT EXISTS never alters an existing table, so add new
  // columns idempotently here (SQLite throws if the column already exists —
  // that's the "already migrated" case, so swallow it).
  for (const ddl of [
    "ALTER TABLE backups ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'",
  ]) {
    try {
      sqlite.exec(ddl);
    } catch {
      // column already present
    }
  }

  // Seed the global instructions row and the five agents (idempotent).
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO instructions (scope, content) VALUES ('global', '')",
    )
    .run();
  const seedAgent = sqlite.prepare(
    "INSERT OR IGNORE INTO agents (key, display_name, manage_enabled) VALUES (?, ?, 1)",
  );
  for (const key of AGENT_KEYS) {
    seedAgent.run(key, AGENT_DISPLAY[key]);
  }
}

// Singleton across Next.js dev hot-reloads.
const globalForDb = globalThis as unknown as {
  __mcpManageDb?: BetterSQLite3Database<typeof schema>;
  __mcpManageSqlite?: Database.Database;
};

function init(): BetterSQLite3Database<typeof schema> {
  ensureDataDirs();
  const sqlite = new Database(DB_PATH);
  bootstrap(sqlite);
  globalForDb.__mcpManageSqlite = sqlite;
  return drizzle(sqlite, { schema });
}

export const db: BetterSQLite3Database<typeof schema> =
  globalForDb.__mcpManageDb ?? (globalForDb.__mcpManageDb = init());

export { schema };
