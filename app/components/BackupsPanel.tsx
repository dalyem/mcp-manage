"use client";

import { useState } from "react";
import type { BackupDTO } from "./api";
import { sendJSON } from "./api";
import { Button, Card } from "./ui";

export function BackupsPanel({
  backups,
  onRestored,
}: {
  backups: BackupDTO[];
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  async function restore(b: BackupDTO) {
    if (!confirm(`Restore ${b.originalPath} from this backup?`)) return;
    setBusy(b.id);
    try {
      await sendJSON(`/api/backups`, "POST", { id: b.id });
      onRestored();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <button
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((v) => !v)}
      >
        <h2 className="text-base font-semibold">
          Backups{" "}
          <span className="text-sm font-normal text-zinc-500">
            ({backups.length})
          </span>
        </h2>
        <span className="text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3">
          {backups.length === 0 ? (
            <p className="py-3 text-sm text-zinc-500">
              No backups yet. One is taken automatically before every write.
            </p>
          ) : (
            <div className="max-h-72 divide-y divide-zinc-200 overflow-auto dark:divide-zinc-800">
              {backups.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-3 py-2 text-sm"
                >
                  <span className="font-mono text-[11px] text-zinc-500">
                    {b.ts}
                  </span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800">
                    {b.agentKey}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">
                    {b.originalPath}
                  </span>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busy === b.id}
                    onClick={() => restore(b)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
