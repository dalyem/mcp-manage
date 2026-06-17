"use client";

import { useState } from "react";
import type { AgentMeta, AgentStatus } from "./api";
import { Badge, Button, Card, DiffView, Dot, Toggle, cn } from "./ui";

function fileName(p: string | null): string {
  if (!p) return "—";
  return p.replace(/^.*\/(?=[^/]+$)/, "");
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        ok ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400",
      )}
      title={label}
    >
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}

function AgentCard({
  s,
  manage,
  onToggleManage,
  onResync,
}: {
  s: AgentStatus;
  manage: boolean;
  onToggleManage: (v: boolean) => void;
  onResync: () => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const tone: "ok" | "warn" | "error" | "muted" = !s.present
    ? "muted"
    : s.level;
  const hasPending = !!(
    s.pendingServers ||
    s.pendingInstructions ||
    s.pendingSubagents.length
  );

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Dot tone={tone} />
          <div>
            <div className="font-semibold">{s.displayName}</div>
            <div className="font-mono text-[11px] text-zinc-500">
              {fileName(s.configPath)}
            </div>
          </div>
        </div>
        {s.present ? (
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span>manage</span>
            <Toggle checked={manage} onChange={onToggleManage} label="manage agent" />
          </div>
        ) : (
          <Badge tone="muted">not installed</Badge>
        )}
      </div>

      {s.present && (
        <>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <Check ok={s.binaryOnPath} label="on PATH" />
            <Check ok={s.configExists} label="config" />
            <Check ok={s.configParses} label="parses" />
            <Check ok={s.configWritable} label="writable" />
            {s.instructionsSupported ? (
              <Check ok={s.instructionsWritable} label="instructions" />
            ) : (
              <span className="text-zinc-400" title="Cursor rules are UI-only">
                instructions n/a
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {s.drift === "drifted" ? (
                <Badge tone="warn">out of sync</Badge>
              ) : s.drift === "in-sync" ? (
                <Badge tone="ok">in sync</Badge>
              ) : (
                <Badge tone="muted">unknown</Badge>
              )}
              {hasPending && (
                <button
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => setShowDiff((v) => !v)}
                >
                  {showDiff ? "hide" : "preview"} changes
                </button>
              )}
            </div>
            {s.drift === "drifted" && manage && (
              <Button size="sm" variant="primary" onClick={onResync}>
                Re-sync
              </Button>
            )}
          </div>

          {s.messages.length > 0 && (
            <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              {s.messages.join(" · ")}
            </div>
          )}

          {showDiff && hasPending && (
            <div className="mt-2 space-y-2">
              {s.pendingServers && (
                <div>
                  <div className="mb-1 font-mono text-[11px] text-zinc-500">
                    {s.pendingServers.path}
                  </div>
                  <DiffView diff={s.pendingServers.diff} />
                </div>
              )}
              {s.pendingInstructions && (
                <div>
                  <div className="mb-1 font-mono text-[11px] text-zinc-500">
                    {s.pendingInstructions.path}
                  </div>
                  <DiffView diff={s.pendingInstructions.diff} />
                </div>
              )}
              {s.pendingSubagents.map((sa) => (
                <div key={sa.path}>
                  <div className="mb-1 font-mono text-[11px] text-zinc-500">
                    {sa.deleted ? "delete " : ""}
                    {sa.path}
                  </div>
                  <DiffView diff={sa.diff} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function StatusPanel({
  status,
  agents,
  onToggleManage,
  onResync,
}: {
  status: AgentStatus[];
  agents: AgentMeta[];
  onToggleManage: (key: string, v: boolean) => void;
  onResync: (only?: string[]) => void;
}) {
  const manageMap = new Map(agents.map((a) => [a.key, a.manageEnabled]));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {status.map((s) => (
        <AgentCard
          key={s.key}
          s={s}
          manage={manageMap.get(s.key) ?? true}
          onToggleManage={(v) => onToggleManage(s.key, v)}
          onResync={() => onResync([s.key])}
        />
      ))}
    </div>
  );
}
