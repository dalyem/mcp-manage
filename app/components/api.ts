import type { AgentStatus } from "@/lib/sync/engine";
import type {
  AgentMeta,
  BackupDTO,
  ServerDTO,
  ServerInput,
  SkillDTO,
  SkillInput,
  SubagentDTO,
  SubagentInput,
} from "@/lib/data";
import type { SyncResult } from "@/lib/types";
import type { GitHubConfigPublic } from "@/lib/github/config";
import type { RestorePlan } from "@/lib/github/restore";

export type {
  AgentStatus,
  AgentMeta,
  BackupDTO,
  ServerDTO,
  ServerInput,
  SkillDTO,
  SkillInput,
  SubagentDTO,
  SubagentInput,
  SyncResult,
  GitHubConfigPublic,
  RestorePlan,
};

async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `${r.status} ${r.statusText}`);
  }
  return r.json() as Promise<T>;
}

export function getJSON<T>(url: string): Promise<T> {
  return fetch(url, { cache: "no-store" }).then((r) => handle<T>(r));
}

export function sendJSON<T>(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  return fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export interface StatusResponse {
  status: AgentStatus[];
  agents: AgentMeta[];
}
export interface SyncResponse {
  results: SyncResult[];
  dryRun?: boolean;
}
