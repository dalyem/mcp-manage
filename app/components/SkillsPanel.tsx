"use client";

import { useState } from "react";
import {
  SKILL_AGENT_KEYS,
  type AgentKey,
  type SkillAgentKey,
} from "@/lib/types";
import type { SkillDTO, SkillInput } from "./api";
import { sendJSON } from "./api";
import { Badge, Button, Card, Field, Toggle, cn, inputClass } from "./ui";

const AGENT_LABELS: Record<SkillAgentKey, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

function textToTools(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}
function toolsToText(a: string[]): string {
  return a.join(", ");
}

function isSkillAgent(k: AgentKey): k is SkillAgentKey {
  return (SKILL_AGENT_KEYS as readonly AgentKey[]).includes(k);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Exact decoded byte count of a base64 string (0 if it can't be decoded). */
function base64Bytes(s: string): number {
  try {
    return atob(s.replace(/\s/g, "")).length;
  } catch {
    return 0;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface FileRow {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  /** byte size for display. */
  size: number;
}

/** Read an uploaded file, storing UTF-8 text inline or binary as base64. */
async function readUploadedFile(file: File): Promise<FileRow> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let text: string | null = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) text = null; // NUL => treat as binary
  } catch {
    text = null;
  }
  return text !== null
    ? { path: file.name, content: text, encoding: "utf8", size: bytes.length }
    : {
        path: file.name,
        content: arrayBufferToBase64(buf),
        encoding: "base64",
        size: bytes.length,
      };
}

/** Mirror of the server's path rules for instant feedback (server is the gate). */
function badFilePath(p: string): string | null {
  const t = p.trim();
  if (t === "") return "every bundled file needs a path";
  if (t === "SKILL.md") return "SKILL.md is generated automatically";
  if (t.includes("\\")) return `file path must use forward slashes: ${t}`;
  if (t.startsWith("/")) return `file path must be relative: ${t}`;
  if (t.split("/").some((s) => s === "" || s === "." || s === ".."))
    return `invalid file path: ${t}`;
  return null;
}

interface FormState {
  id?: number;
  name: string;
  description: string;
  instructions: string;
  allowedToolsText: string;
  files: FileRow[];
  enabled: boolean;
  targets: AgentKey[];
}

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    instructions: "",
    allowedToolsText: "",
    files: [],
    enabled: true,
    targets: [...SKILL_AGENT_KEYS],
  };
}

function toForm(s: SkillDTO): FormState {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    allowedToolsText: toolsToText(s.allowedTools),
    files: s.files.map((f) => ({
      path: f.path,
      content: f.content,
      encoding: f.encoding,
      size:
        f.encoding === "base64"
          ? base64Bytes(f.content)
          : new Blob([f.content]).size,
    })),
    enabled: s.enabled,
    targets: s.targets.filter(isSkillAgent),
  };
}

function toInput(f: FormState): SkillInput {
  return {
    name: f.name,
    description: f.description,
    instructions: f.instructions,
    allowedTools: textToTools(f.allowedToolsText),
    files: f.files
      .filter((r) => r.path.trim() !== "")
      .map((r) => ({
        path: r.path.trim(),
        content: r.content,
        encoding: r.encoding,
      })),
    enabled: f.enabled,
    targets: f.targets,
  };
}

function SkillForm({
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

  function updateFile(i: number, patch: Partial<FileRow>) {
    setF((prev) => ({
      ...prev,
      files: prev.files.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));
  }
  function addFile() {
    setF((prev) => ({
      ...prev,
      files: [...prev.files, { path: "", content: "", encoding: "utf8", size: 0 }],
    }));
  }
  function removeFile(i: number) {
    setF((prev) => ({ ...prev, files: prev.files.filter((_, j) => j !== i) }));
  }
  async function onUpload(file: File) {
    try {
      const row = await readUploadedFile(file);
      setF((prev) => ({ ...prev, files: [...prev.files, row] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Light client-side validation; the server re-validates authoritatively. */
  function validate(): string | null {
    if (!f.name.trim()) return "name is required";
    if (!f.description.trim()) return "description is required";
    if (!f.instructions.trim()) return "instructions are required";
    const seen = new Set<string>();
    for (const r of f.files) {
      const err = badFilePath(r.path);
      if (err) return err;
      const key = r.path.trim();
      if (seen.has(key)) return `duplicate bundled file path: ${key}`;
      seen.add(key);
    }
    return null;
  }

  async function save() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = toInput(f);
      if (f.id) await sendJSON(`/api/skills/${f.id}`, "PUT", input);
      else await sendJSON(`/api/skills`, "POST", input);
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
            {f.id ? "Edit skill" : "Add skill"}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="space-y-3">
          <Field label="Name" hint="lowercase, dashes — becomes the skill folder name">
            <input
              className={inputClass}
              value={f.name}
              placeholder="pdf-tools"
              disabled={!!f.id}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>

          <Field label="Description" hint="when the agent should load this skill">
            <input
              className={inputClass}
              value={f.description}
              placeholder="Use when extracting text or tables from PDF files"
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>

          <Field label="Instructions" hint="the SKILL.md body (markdown)">
            <textarea
              className={cn(inputClass, "h-40 font-mono")}
              value={f.instructions}
              placeholder={
                "Step-by-step instructions for the agent. Reference bundled files by path, e.g. run scripts/extract.py…"
              }
              onChange={(e) => set("instructions", e.target.value)}
            />
          </Field>

          <Field label="Allowed tools" hint="optional; comma-separated; blank = inherit">
            <input
              className={inputClass}
              value={f.allowedToolsText}
              placeholder="Read, Bash"
              onChange={(e) => set("allowedToolsText", e.target.value)}
            />
          </Field>

          <Field
            label="Bundled files"
            hint="shipped alongside SKILL.md inside the skill folder"
          >
            <div className="space-y-2">
              {f.files.length === 0 && (
                <p className="text-xs text-zinc-500">
                  No bundled files. SKILL.md is generated from the fields above.
                </p>
              )}
              {f.files.map((file, i) => (
                <div
                  key={i}
                  className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <div className="flex items-center gap-2">
                    <input
                      className={cn(inputClass, "flex-1 font-mono text-xs")}
                      value={file.path}
                      placeholder="scripts/run.py"
                      onChange={(e) => updateFile(i, { path: e.target.value })}
                    />
                    {file.encoding === "base64" && (
                      <Badge tone="muted">
                        binary · {formatBytes(file.size)}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFile(i)}
                    >
                      ✕
                    </Button>
                  </div>
                  {file.encoding === "utf8" ? (
                    <textarea
                      className={cn(inputClass, "mt-2 h-24 font-mono text-xs")}
                      value={file.content}
                      placeholder="file contents…"
                      onChange={(e) =>
                        updateFile(i, {
                          content: e.target.value,
                          size: new Blob([e.target.value]).size,
                        })
                      }
                    />
                  ) : (
                    <p className="mt-2 text-xs text-zinc-500">
                      Binary file — stored as-is (not editable here).
                    </p>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3 pt-1">
                <Button size="sm" onClick={addFile}>
                  + Add file
                </Button>
                <label className="cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400">
                  Upload file
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const fl = e.target.files;
                      if (fl && fl.length) void onUpload(fl[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          </Field>

          <Field label="Apply to agents">
            <div className="flex flex-wrap gap-2 pt-1">
              {SKILL_AGENT_KEYS.map((key) => (
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

export function SkillsPanel({
  skills,
  onChanged,
}: {
  skills: SkillDTO[];
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleEnabled(s: SkillDTO) {
    setBusyId(s.id);
    setError(null);
    try {
      await sendJSON(`/api/skills/${s.id}`, "PUT", {
        enabledOnly: true,
        enabled: !s.enabled,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: SkillDTO) {
    if (!confirm(`Delete "${s.name}" and remove it from all agents?`)) return;
    setBusyId(s.id);
    setError(null);
    try {
      await sendJSON(`/api/skills/${s.id}`, "DELETE");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Skills</h2>
        <Button variant="primary" size="sm" onClick={() => setForm(emptyForm())}>
          + Add skill
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {skills.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">
          No skills yet. Add one and it propagates as a SKILL.md folder to every
          targeted agent.
        </p>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {skills.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <Toggle
                checked={s.enabled}
                onChange={() => toggleEnabled(s)}
                label="enabled"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  {s.files.length > 0 && (
                    <Badge tone="muted">
                      {s.files.length} file{s.files.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                <div className="truncate text-[11px] text-zinc-500">
                  {s.description || "—"}
                </div>
              </div>
              <div className="hidden gap-1 sm:flex">
                {s.targets.filter(isSkillAgent).map((t) => (
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
        <SkillForm
          initial={form}
          onClose={() => setForm(null)}
          onSaved={onChanged}
        />
      )}
    </Card>
  );
}
