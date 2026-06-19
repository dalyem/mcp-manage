"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AgentMeta,
  AgentStatus,
  BackupDTO,
  GitHubConfigPublic,
  ServerDTO,
  SkillDTO,
  StatusResponse,
  SubagentDTO,
  SyncResponse,
} from "./api";
import { getJSON, sendJSON } from "./api";
import { Badge, Button, Dot } from "./ui";
import { StatusPanel } from "./StatusPanel";
import { ServersPanel } from "./ServersPanel";
import { SubagentsPanel } from "./SubagentsPanel";
import { SkillsPanel } from "./SkillsPanel";
import { InstructionsPanel } from "./InstructionsPanel";
import { BackupsPanel } from "./BackupsPanel";
import { GitHubPanel } from "./GitHubPanel";

function globalLevel(status: AgentStatus[]): "ok" | "warn" | "error" | "muted" {
  const active = status.filter((s) => s.present && s.manageEnabled);
  if (active.some((s) => s.level === "error")) return "error";
  if (active.some((s) => s.level === "warn" || s.drift === "drifted"))
    return "warn";
  if (active.length === 0) return "muted";
  return "ok";
}

function summarize(results: SyncResponse["results"]): string {
  const updated = results.filter((r) => r.status === "ok" && r.changed).length;
  const errors = results.filter((r) => r.status === "error").length;
  const parts: string[] = [];
  parts.push(`${updated} file${updated === 1 ? "" : "s"} updated`);
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function Dashboard() {
  const [status, setStatus] = useState<AgentStatus[]>([]);
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [servers, setServers] = useState<ServerDTO[]>([]);
  const [subagents, setSubagents] = useState<SubagentDTO[]>([]);
  const [skills, setSkills] = useState<SkillDTO[]>([]);
  const [instructions, setInstructions] = useState("");
  const [backups, setBackups] = useState<BackupDTO[]>([]);
  const [githubConfig, setGithubConfig] = useState<GitHubConfigPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [st, sv, sa, sk, instr, bk, gh] = await Promise.all([
        getJSON<StatusResponse>("/api/status"),
        getJSON<{ servers: ServerDTO[] }>("/api/servers"),
        getJSON<{ subagents: SubagentDTO[] }>("/api/subagents"),
        getJSON<{ skills: SkillDTO[] }>("/api/skills"),
        getJSON<{ content: string }>("/api/instructions"),
        getJSON<{ backups: BackupDTO[] }>("/api/backups"),
        getJSON<{ config: GitHubConfigPublic }>("/api/github/config"),
      ]);
      setStatus(st.status);
      setAgents(st.agents);
      setServers(sv.servers);
      setSubagents(sa.subagents);
      setSkills(sk.skills);
      setInstructions(instr.content);
      setBackups(bk.backups);
      setGithubConfig(gh.config);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load. refresh() only calls setState after its awaited fetches
    // resolve (never synchronously), so the cascading-render rule doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const resync = useCallback(
    async (only?: string[]) => {
      setBusy(true);
      try {
        const res = await sendJSON<SyncResponse>("/api/sync", "POST", { only });
        flash(`Synced — ${summarize(res.results)}`);
        await refresh();
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [flash, refresh],
  );

  const toggleManage = useCallback(
    async (key: string, v: boolean) => {
      // optimistic
      setAgents((prev) =>
        prev.map((a) => (a.key === key ? { ...a, manageEnabled: v } : a)),
      );
      try {
        await sendJSON(`/api/agents/${key}`, "PUT", { manageEnabled: v });
        await refresh();
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e));
        await refresh();
      }
    },
    [flash, refresh],
  );

  const onChanged = useCallback(async () => {
    await refresh();
    flash("Saved & synced");
  }, [refresh, flash]);

  const level = globalLevel(status);
  const levelLabel = {
    ok: "All in sync",
    warn: "Action needed",
    error: "Errors",
    muted: "No managed agents",
  }[level];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">mcp-manage</h1>
          <p className="text-sm text-zinc-500">
            One place to configure MCP servers, subagents &amp; global
            instructions across all your AI coding agents.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm">
            <Dot tone={level === "muted" ? "muted" : level} />
            {levelLabel}
          </span>
          <Button onClick={() => refresh()} disabled={busy}>
            Re-scan
          </Button>
          <Button variant="primary" onClick={() => resync()} disabled={busy}>
            {busy ? "Syncing…" : "Re-sync all"}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              System Status
            </h2>
            <StatusPanel
              status={status}
              agents={agents}
              onToggleManage={toggleManage}
              onResync={resync}
            />
          </section>

          <ServersPanel servers={servers} onChanged={onChanged} />
          <SubagentsPanel subagents={subagents} onChanged={onChanged} />
          <SkillsPanel skills={skills} onChanged={onChanged} />
          <InstructionsPanel content={instructions} onSaved={onChanged} />
          <BackupsPanel backups={backups} onRestored={onChanged} />
          <GitHubPanel
            config={githubConfig}
            onChanged={onChanged}
            flash={flash}
          />
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <Badge tone="info">{toast}</Badge>
        </div>
      )}
    </div>
  );
}
