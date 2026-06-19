// Restore a snapshot into the local database. Because backups are redacted, the
// merge is secret-preserving: a redacted env/header value keeps the existing
// local secret (if any) instead of blanking it. Restore is non-destructive — it
// upserts by name and never deletes local items absent from the snapshot.
import {
  createServer,
  createSubagent,
  getInstructions,
  listAgentsMeta,
  listServers,
  listSubagents,
  setAgentManage,
  setInstructions,
  updateServer,
  updateSubagent,
  type ServerDTO,
  type ServerInput,
  type SubagentInput,
} from "../data";
import { syncAll } from "../sync/engine";
import type { AgentKey, SyncResult } from "../types";
import { isSentinel, SECRET_SENTINEL } from "./redact";
import type { Snapshot, SnapshotServer, SnapshotSubagent } from "./snapshot";

export interface RestoreServerPlan {
  name: string;
  action: "create" | "update" | "unchanged";
  /** secret keys whose existing local value will be kept */
  secretKeysPreserved: string[];
  /** secret keys that will be blank (no local value to preserve) */
  secretKeysBlank: string[];
  /** a redacted token still sits in args/url and cannot be recovered */
  argsUrlStillRedacted: boolean;
}

export interface RestoreSubagentPlan {
  name: string;
  action: "create" | "update" | "unchanged";
}

export interface RestoreAgentPlan {
  key: AgentKey;
  from: boolean;
  to: boolean;
  changed: boolean;
}

export interface RestorePlan {
  servers: RestoreServerPlan[];
  subagents: RestoreSubagentPlan[];
  instructions: { action: "update" | "unchanged" };
  agents: RestoreAgentPlan[];
  /** present locally but absent from the snapshot — kept, never deleted */
  localOnly: { servers: string[]; subagents: string[] };
  warnings: string[];
}

interface ComputedServer extends RestoreServerPlan {
  input: ServerInput;
  localId?: number;
}
interface ComputedSubagent extends RestoreSubagentPlan {
  input: SubagentInput;
  localId?: number;
}
interface Computed {
  plan: RestorePlan;
  servers: ComputedServer[];
  subagents: ComputedSubagent[];
  instructionsContent: string;
  instructionsChanged: boolean;
  agents: { key: AgentKey; manageEnabled: boolean }[];
}

function sorted(a: readonly string[]): string[] {
  return [...a].sort();
}

/** Merge one snapshot server with its local counterpart, preserving secrets. */
function mergeServer(snap: SnapshotServer, local: ServerDTO | undefined) {
  const preserved: string[] = [];
  const blank: string[] = [];

  function mergeRecord(
    snapRec: Record<string, string>,
    localRec: Record<string, string> | undefined,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(snapRec ?? {})) {
      if (isSentinel(value)) {
        const localValue = localRec?.[key];
        if (localValue) {
          out[key] = localValue;
          preserved.push(key);
        } else {
          out[key] = "";
          blank.push(key);
        }
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  const env = mergeRecord(snap.env, local?.env);
  const headers = mergeRecord(snap.headers, local?.headers);
  const args = snap.args ?? [];
  const url = snap.url ?? "";

  const input: ServerInput = {
    name: snap.name,
    transport: snap.transport,
    command: snap.command,
    args,
    env,
    url,
    headers,
    enabled: snap.enabled,
    targets: snap.targets,
  };

  const argsUrlStillRedacted =
    args.some((a) => a.includes(SECRET_SENTINEL)) || url.includes(SECRET_SENTINEL);

  return { input, preserved, blank, argsUrlStillRedacted };
}

function serverShape(s: {
  transport: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  targets: readonly AgentKey[];
}): string {
  return JSON.stringify({
    transport: s.transport,
    command: s.command,
    args: s.args,
    env: s.env,
    url: s.url,
    headers: s.headers,
    enabled: s.enabled,
    targets: sorted(s.targets),
  });
}

function subagentInput(snap: SnapshotSubagent): SubagentInput {
  return {
    name: snap.name,
    description: snap.description,
    prompt: snap.prompt,
    model: snap.model,
    tools: snap.tools,
    color: snap.color,
    enabled: snap.enabled,
    targets: snap.targets,
  };
}

function subagentShape(s: {
  description: string;
  prompt: string;
  model: string;
  tools: string[];
  color: string;
  enabled: boolean;
  targets: readonly AgentKey[];
}): string {
  return JSON.stringify({
    description: s.description,
    prompt: s.prompt,
    model: s.model,
    tools: s.tools,
    color: s.color,
    enabled: s.enabled,
    targets: sorted(s.targets),
  });
}

function compute(snapshot: Snapshot): Computed {
  const localServers = listServers();
  const localSubagents = listSubagents();
  const localServerByName = new Map(localServers.map((s) => [s.name, s]));
  const localSubByName = new Map(localSubagents.map((s) => [s.name, s]));
  const localAgents = new Map(listAgentsMeta().map((a) => [a.key, a.manageEnabled]));
  const warnings: string[] = [];

  const servers: ComputedServer[] = snapshot.servers.map((snap) => {
    const local = localServerByName.get(snap.name);
    const { input, preserved, blank, argsUrlStillRedacted } = mergeServer(snap, local);
    let action: RestoreServerPlan["action"];
    if (!local) action = "create";
    else
      action =
        serverShape({
          transport: input.transport,
          command: input.command ?? "",
          args: input.args ?? [],
          env: input.env ?? {},
          url: input.url ?? "",
          headers: input.headers ?? {},
          enabled: input.enabled ?? true,
          targets: input.targets ?? [],
        }) === serverShape(local)
          ? "unchanged"
          : "update";
    return {
      name: snap.name,
      action,
      secretKeysPreserved: preserved,
      secretKeysBlank: blank,
      argsUrlStillRedacted,
      input,
      localId: local?.id,
    };
  });

  const subagents: ComputedSubagent[] = snapshot.subagents.map((snap) => {
    const local = localSubByName.get(snap.name);
    const input = subagentInput(snap);
    let action: RestoreSubagentPlan["action"];
    if (!local) action = "create";
    else
      action =
        subagentShape({
          description: input.description ?? "",
          prompt: input.prompt ?? "",
          model: input.model ?? "",
          tools: input.tools ?? [],
          color: input.color ?? "",
          enabled: input.enabled ?? true,
          targets: input.targets ?? [],
        }) === subagentShape(local)
          ? "unchanged"
          : "update";
    return { name: snap.name, action, input, localId: local?.id };
  });

  const instructionsChanged = snapshot.instructions !== getInstructions();

  const agents: RestoreAgentPlan[] = snapshot.agents.map((a) => {
    const from = localAgents.get(a.key) ?? true;
    return { key: a.key, from, to: a.manageEnabled, changed: from !== a.manageEnabled };
  });

  const snapServerNames = new Set(snapshot.servers.map((s) => s.name));
  const snapSubNames = new Set(snapshot.subagents.map((s) => s.name));
  const localOnly = {
    servers: localServers.filter((s) => !snapServerNames.has(s.name)).map((s) => s.name),
    subagents: localSubagents.filter((s) => !snapSubNames.has(s.name)).map((s) => s.name),
  };

  const needSecret = servers.filter((s) => s.secretKeysBlank.length > 0).length;
  if (needSecret > 0)
    warnings.push(
      `${needSecret} server${needSecret === 1 ? "" : "s"} will have blank secret values to re-enter.`,
    );
  const stillRedacted = servers.filter((s) => s.argsUrlStillRedacted).length;
  if (stillRedacted > 0)
    warnings.push(
      `${stillRedacted} server${stillRedacted === 1 ? "" : "s"} still contain redacted tokens in args/url that can't be recovered.`,
    );

  const plan: RestorePlan = {
    servers: servers.map((s) => ({
      name: s.name,
      action: s.action,
      secretKeysPreserved: s.secretKeysPreserved,
      secretKeysBlank: s.secretKeysBlank,
      argsUrlStillRedacted: s.argsUrlStillRedacted,
    })),
    subagents: subagents.map((s) => ({ name: s.name, action: s.action })),
    instructions: { action: instructionsChanged ? "update" : "unchanged" },
    agents,
    localOnly,
    warnings,
  };

  return {
    plan,
    servers,
    subagents,
    instructionsContent: snapshot.instructions,
    instructionsChanged,
    agents: snapshot.agents.map((a) => ({ key: a.key, manageEnabled: a.manageEnabled })),
  };
}

/** Read-only: what a restore would change. */
export function previewRestore(snapshot: Snapshot): RestorePlan {
  return compute(snapshot).plan;
}

/** Apply the merge to the database, then sync to agent files. */
export function applyRestore(snapshot: Snapshot): {
  plan: RestorePlan;
  results: SyncResult[];
} {
  const c = compute(snapshot);
  const warnings = [...c.plan.warnings];

  for (const s of c.servers) {
    if (s.action === "unchanged") continue;
    try {
      if (s.localId != null) updateServer(s.localId, s.input);
      else createServer(s.input);
    } catch (e) {
      warnings.push(`server ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const s of c.subagents) {
    if (s.action === "unchanged") continue;
    try {
      if (s.localId != null) updateSubagent(s.localId, s.input);
      else createSubagent(s.input);
    } catch (e) {
      warnings.push(`subagent ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (c.instructionsChanged) setInstructions(c.instructionsContent);
  for (const a of c.agents) setAgentManage(a.key, a.manageEnabled);

  const results = syncAll();
  return { plan: { ...c.plan, warnings }, results };
}
