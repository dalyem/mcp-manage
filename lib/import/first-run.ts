import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  appMeta,
  managedEntries,
  managedSubagents,
  mcpServers,
  serverTargets,
  subagentTargets,
  subagents,
} from "../db/schema";
import { ADAPTER_LIST, anyBinaryOnPath } from "../agents";
import { dirExists, fileExists, listFiles, readText } from "../fs-utils";
import type { AgentKey, NormalizedServer, NormalizedSubagent } from "../types";

const FIRST_RUN_KEY = "first_run_import_done";
const FIRST_RUN_SUBAGENTS_KEY = "first_run_subagent_import_done";

function present(binaries: string[], configPath: string, configDir: string) {
  return (
    anyBinaryOnPath(binaries) || fileExists(configPath) || dirExists(configDir)
  );
}

interface Discovered {
  server: NormalizedServer;
  agents: Set<AgentKey>;
}

/**
 * Scan every installed agent's config, adopt the MCP servers it already has
 * into the central store (deduped by name; targets = the agents it was found
 * in), and seed the owned-set so the tool now manages them. Idempotent at the
 * row level — only inserts servers whose name isn't already present.
 */
export function importExisting(): { imported: string[] } {
  const discovered = new Map<string, Discovered>();

  for (const adapter of ADAPTER_LIST) {
    if (!present(adapter.binaries, adapter.configPath, adapter.configDir))
      continue;
    const content = readText(adapter.configPath);
    let servers: NormalizedServer[] = [];
    try {
      servers = adapter.parseServers(content);
    } catch {
      servers = [];
    }
    for (const s of servers) {
      if (!s.name) continue;
      const existing = discovered.get(s.name);
      if (existing) {
        existing.agents.add(adapter.key);
      } else {
        discovered.set(s.name, { server: s, agents: new Set([adapter.key]) });
      }
    }
  }

  const imported: string[] = [];
  db.transaction((tx) => {
    for (const [name, d] of discovered) {
      const already = tx
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(eq(mcpServers.name, name))
        .get();

      let serverId: number;
      if (already) {
        serverId = already.id;
      } else {
        const s = d.server;
        const res = tx
          .insert(mcpServers)
          .values({
            name: s.name,
            transport: s.transport,
            command: s.command,
            args: s.args,
            env: s.env,
            url: s.url,
            headers: s.headers,
            enabled: true,
          })
          .run();
        serverId = Number(res.lastInsertRowid);
        imported.push(name);
      }

      for (const agentKey of d.agents) {
        tx.insert(serverTargets)
          .values({ serverId, agentKey })
          .onConflictDoNothing()
          .run();
        // Adopt: mark this server as owned in the agent that already had it.
        tx.insert(managedEntries)
          .values({ agentKey, serverName: name })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  return { imported };
}

interface DiscoveredSubagent {
  subagent: NormalizedSubagent;
  agents: Set<AgentKey>;
}

/**
 * Scan every installed agent's subagents dir, adopt the subagents it already
 * has into the central store (deduped by name; targets = the agents it was
 * found in), and seed the owned-set so the tool now manages them. Idempotent at
 * the row level — only inserts subagents whose name isn't already present.
 */
export function importExistingSubagents(): { imported: string[] } {
  const discovered = new Map<string, DiscoveredSubagent>();

  for (const adapter of ADAPTER_LIST) {
    if (!adapter.subagents || !adapter.agentsDir) continue;
    if (!present(adapter.binaries, adapter.configPath, adapter.configDir))
      continue;
    const fmt = adapter.subagents;
    const dir = adapter.agentsDir;
    for (const file of listFiles(dir)) {
      const name = fmt.nameFromFile(file);
      if (!name) continue;
      const content = readText(path.join(dir, file));
      if (content === null) continue;
      let sa: NormalizedSubagent;
      try {
        sa = fmt.parse(name, content);
      } catch {
        continue;
      }
      if (!sa.name) continue;
      const existing = discovered.get(sa.name);
      if (existing) {
        existing.agents.add(adapter.key);
      } else {
        discovered.set(sa.name, { subagent: sa, agents: new Set([adapter.key]) });
      }
    }
  }

  const imported: string[] = [];
  db.transaction((tx) => {
    for (const [name, d] of discovered) {
      const already = tx
        .select({ id: subagents.id })
        .from(subagents)
        .where(eq(subagents.name, name))
        .get();

      let subagentId: number;
      if (already) {
        subagentId = already.id;
      } else {
        const s = d.subagent;
        const res = tx
          .insert(subagents)
          .values({
            name: s.name,
            description: s.description,
            prompt: s.prompt,
            model: s.model,
            tools: s.tools,
            color: s.color,
            enabled: true,
          })
          .run();
        subagentId = Number(res.lastInsertRowid);
        imported.push(name);
      }

      for (const agentKey of d.agents) {
        tx.insert(subagentTargets)
          .values({ subagentId, agentKey })
          .onConflictDoNothing()
          .run();
        tx.insert(managedSubagents)
          .values({ agentKey, name })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  return { imported };
}

function runOnce(flagKey: string, fn: () => void): void {
  const flag = db
    .select()
    .from(appMeta)
    .where(eq(appMeta.key, flagKey))
    .get();
  if (flag?.value === "1") return;

  fn();

  db.insert(appMeta)
    .values({ key: flagKey, value: "1" })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: "1" } })
    .run();
}

/** Run the one-time imports (servers + subagents), each guarded independently. */
export function ensureFirstRun(): void {
  runOnce(FIRST_RUN_KEY, importExisting);
  runOnce(FIRST_RUN_SUBAGENTS_KEY, importExistingSubagents);
}
