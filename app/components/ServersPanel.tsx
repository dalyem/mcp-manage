"use client";

import { useState } from "react";
import { AGENT_KEYS, type AgentKey, type Transport } from "@/lib/types";
import type { ServerDTO, ServerInput } from "./api";
import { sendJSON } from "./api";
import { Badge, Button, Card, Field, Toggle, cn, inputClass } from "./ui";

const AGENT_LABELS: Record<AgentKey, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  opencode: "OpenCode",
};

function linesToArray(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
function arrayToLines(a: string[]): string {
  return a.join("\n");
}
function linesToRecord(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}
function recordToLines(r: Record<string, string>): string {
  return Object.entries(r)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

interface FormState {
  id?: number;
  name: string;
  transport: Transport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  enabled: boolean;
  targets: AgentKey[];
}

function emptyForm(): FormState {
  return {
    name: "",
    transport: "stdio",
    command: "",
    argsText: "",
    envText: "",
    url: "",
    headersText: "",
    enabled: true,
    targets: [...AGENT_KEYS],
  };
}

function toForm(s: ServerDTO): FormState {
  return {
    id: s.id,
    name: s.name,
    transport: s.transport,
    command: s.command,
    argsText: arrayToLines(s.args),
    envText: recordToLines(s.env),
    url: s.url,
    headersText: recordToLines(s.headers),
    enabled: s.enabled,
    targets: s.targets,
  };
}

function toInput(f: FormState): ServerInput {
  return {
    name: f.name,
    transport: f.transport,
    command: f.command,
    args: linesToArray(f.argsText),
    env: linesToRecord(f.envText),
    url: f.url,
    headers: linesToRecord(f.headersText),
    enabled: f.enabled,
    targets: f.targets,
  };
}

function ServerForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: FormState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isStdio = f.transport === "stdio";

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  function toggleTarget(key: AgentKey) {
    setF((prev) => ({
      ...prev,
      targets: prev.targets.includes(key)
        ? prev.targets.filter((t) => t !== key)
        : [...prev.targets, key],
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input = toInput(f);
      if (f.id) await sendJSON(`/api/servers/${f.id}`, "PUT", input);
      else await sendJSON(`/api/servers`, "POST", input);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
      <Card className="my-8 w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {f.id ? "Edit server" : "Add MCP server"}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input
                className={inputClass}
                value={f.name}
                placeholder="playwright"
                disabled={!!f.id}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Transport">
              <select
                className={inputClass}
                value={f.transport}
                onChange={(e) => set("transport", e.target.value as Transport)}
              >
                <option value="stdio">stdio (local command)</option>
                <option value="http">http (streamable)</option>
                <option value="sse">sse</option>
              </select>
            </Field>
          </div>

          {isStdio ? (
            <>
              <Field label="Command" hint="e.g. npx">
                <input
                  className={inputClass}
                  value={f.command}
                  placeholder="npx"
                  onChange={(e) => set("command", e.target.value)}
                />
              </Field>
              <Field label="Args" hint="one per line">
                <textarea
                  className={cn(inputClass, "h-20 font-mono")}
                  value={f.argsText}
                  placeholder={"-y\n@playwright/mcp@latest"}
                  onChange={(e) => set("argsText", e.target.value)}
                />
              </Field>
              <Field label="Environment" hint="KEY=VALUE, one per line">
                <textarea
                  className={cn(inputClass, "h-16 font-mono")}
                  value={f.envText}
                  placeholder="API_KEY=secret"
                  onChange={(e) => set("envText", e.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="URL">
                <input
                  className={inputClass}
                  value={f.url}
                  placeholder="https://mcp.example.com/mcp"
                  onChange={(e) => set("url", e.target.value)}
                />
              </Field>
              <Field label="Headers" hint="KEY=VALUE, one per line">
                <textarea
                  className={cn(inputClass, "h-16 font-mono")}
                  value={f.headersText}
                  placeholder="Authorization=Bearer xyz"
                  onChange={(e) => set("headersText", e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Apply to agents">
            <div className="flex flex-wrap gap-2 pt-1">
              {AGENT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleTarget(key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    f.targets.includes(key)
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : "border-zinc-300 text-zinc-500 dark:border-zinc-700",
                  )}
                >
                  {AGENT_LABELS[key]}
                </button>
              ))}
            </div>
          </Field>

          <div className="flex items-center gap-2 pt-1">
            <Toggle checked={f.enabled} onChange={(v) => set("enabled", v)} />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Enabled
            </span>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save & sync"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function ServersPanel({
  servers,
  onChanged,
}: {
  servers: ServerDTO[];
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function toggleEnabled(s: ServerDTO) {
    setBusyId(s.id);
    try {
      await sendJSON(`/api/servers/${s.id}`, "PUT", {
        enabledOnly: true,
        enabled: !s.enabled,
      });
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: ServerDTO) {
    if (!confirm(`Delete "${s.name}" and remove it from all agents?`)) return;
    setBusyId(s.id);
    try {
      await sendJSON(`/api/servers/${s.id}`, "DELETE");
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">MCP Servers</h2>
        <Button variant="primary" size="sm" onClick={() => setForm(emptyForm())}>
          + Add server
        </Button>
      </div>

      {servers.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">
          No servers yet. Add one and it propagates to every managed agent.
        </p>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {servers.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <Toggle
                checked={s.enabled}
                onChange={() => toggleEnabled(s)}
                label="enabled"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge tone="info">{s.transport}</Badge>
                </div>
                <div className="truncate font-mono text-[11px] text-zinc-500">
                  {s.transport === "stdio"
                    ? [s.command, ...s.args].join(" ")
                    : s.url}
                </div>
              </div>
              <div className="hidden gap-1 sm:flex">
                {s.targets.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    {AGENT_LABELS[t]}
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busyId === s.id}
                onClick={() => setForm(toForm(s))}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busyId === s.id}
                onClick={() => remove(s)}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      {form && (
        <ServerForm
          initial={form}
          onClose={() => setForm(null)}
          onSaved={onChanged}
        />
      )}
    </Card>
  );
}
