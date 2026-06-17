"use client";

import { useState } from "react";
import { AGENT_KEYS, type AgentKey } from "@/lib/types";
import type { SubagentDTO, SubagentInput } from "./api";
import { sendJSON } from "./api";
import { Badge, Button, Card, Field, Toggle, cn, inputClass } from "./ui";

const AGENT_LABELS: Record<AgentKey, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  opencode: "OpenCode",
};

const COLORS = [
  "",
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
];

function textToTools(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}
function toolsToText(a: string[]): string {
  return a.join(", ");
}

interface FormState {
  id?: number;
  name: string;
  description: string;
  prompt: string;
  model: string;
  toolsText: string;
  color: string;
  enabled: boolean;
  targets: AgentKey[];
}

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    prompt: "",
    model: "",
    toolsText: "",
    color: "",
    enabled: true,
    targets: [...AGENT_KEYS],
  };
}

function toForm(s: SubagentDTO): FormState {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    prompt: s.prompt,
    model: s.model,
    toolsText: toolsToText(s.tools),
    color: s.color,
    enabled: s.enabled,
    targets: s.targets,
  };
}

function toInput(f: FormState): SubagentInput {
  return {
    name: f.name,
    description: f.description,
    prompt: f.prompt,
    model: f.model,
    tools: textToTools(f.toolsText),
    color: f.color,
    enabled: f.enabled,
    targets: f.targets,
  };
}

function SubagentForm({
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
      if (f.id) await sendJSON(`/api/subagents/${f.id}`, "PUT", input);
      else await sendJSON(`/api/subagents`, "POST", input);
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
            {f.id ? "Edit subagent" : "Add subagent"}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" hint="lowercase, dashes">
              <input
                className={inputClass}
                value={f.name}
                placeholder="code-reviewer"
                disabled={!!f.id}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Color" hint="where supported">
              <select
                className={inputClass}
                value={f.color}
                onChange={(e) => set("color", e.target.value)}
              >
                {COLORS.map((c) => (
                  <option key={c || "none"} value={c}>
                    {c || "none"}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Description" hint="when the agent should delegate here">
            <input
              className={inputClass}
              value={f.description}
              placeholder="Reviews code for quality and best practices"
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>

          <Field label="System prompt">
            <textarea
              className={cn(inputClass, "h-40 font-mono")}
              value={f.prompt}
              placeholder={
                "You are a senior code reviewer. When invoked, analyze the diff and…"
              }
              onChange={(e) => set("prompt", e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Model" hint="blank = inherit">
              <input
                className={inputClass}
                value={f.model}
                placeholder="inherit"
                onChange={(e) => set("model", e.target.value)}
              />
            </Field>
            <Field label="Tools" hint="comma-separated; blank = all">
              <input
                className={inputClass}
                value={f.toolsText}
                placeholder="Read, Grep, Glob"
                onChange={(e) => set("toolsText", e.target.value)}
              />
            </Field>
          </div>

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

export function SubagentsPanel({
  subagents,
  onChanged,
}: {
  subagents: SubagentDTO[];
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function toggleEnabled(s: SubagentDTO) {
    setBusyId(s.id);
    try {
      await sendJSON(`/api/subagents/${s.id}`, "PUT", {
        enabledOnly: true,
        enabled: !s.enabled,
      });
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: SubagentDTO) {
    if (!confirm(`Delete "${s.name}" and remove it from all agents?`)) return;
    setBusyId(s.id);
    try {
      await sendJSON(`/api/subagents/${s.id}`, "DELETE");
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Subagents</h2>
        <Button variant="primary" size="sm" onClick={() => setForm(emptyForm())}>
          + Add subagent
        </Button>
      </div>

      {subagents.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">
          No subagents yet. Add one and it propagates to every managed agent.
        </p>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {subagents.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <Toggle
                checked={s.enabled}
                onChange={() => toggleEnabled(s)}
                label="enabled"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  {s.model && <Badge tone="info">{s.model}</Badge>}
                </div>
                <div className="truncate text-[11px] text-zinc-500">
                  {s.description || "—"}
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
        <SubagentForm
          initial={form}
          onClose={() => setForm(null)}
          onSaved={onChanged}
        />
      )}
    </Card>
  );
}
