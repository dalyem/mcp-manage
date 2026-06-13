"use client";

import { useState } from "react";
import { sendJSON } from "./api";
import { Badge, Button, Card, cn, inputClass } from "./ui";

export function InstructionsPanel({
  content,
  onSaved,
}: {
  content: string;
  onSaved: () => void;
}) {
  const [text, setText] = useState(content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== content;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await sendJSON(`/api/instructions`, "PUT", { content: text });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">Global Instructions</h2>
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : dirty ? "Save & sync" : "Saved"}
        </Button>
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        Written into a managed block of each agent&apos;s global instruction
        file (your own notes outside the block are preserved):
        <span className="ml-1 font-mono">~/.claude/CLAUDE.md</span>,
        <span className="ml-1 font-mono">~/.codex/AGENTS.md</span>,
        <span className="ml-1 font-mono">~/.config/opencode/AGENTS.md</span>,
        <span className="ml-1 font-mono">~/.gemini/GEMINI.md</span>.
      </p>
      <div className="mb-2">
        <Badge tone="warn">Cursor: not file-manageable (rules are UI-only)</Badge>
      </div>
      <textarea
        className={cn(inputClass, "h-56 font-mono text-[13px] leading-relaxed")}
        value={text}
        placeholder={"# My global rules\n\n- Prefer TypeScript strict mode\n- Always write tests for new modules"}
        onChange={(e) => setText(e.target.value)}
      />
      {error && (
        <div className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </Card>
  );
}
