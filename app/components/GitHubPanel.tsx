"use client";

import { useState } from "react";
import type { GitHubConfigPublic, RestorePlan } from "./api";
import { getJSON, sendJSON } from "./api";
import { Badge, Button, Card, Field, Toggle, cn, inputClass } from "./ui";

interface TestResult {
  defaultBranch: string;
  private: boolean;
  canPush: boolean;
  branchExists: boolean;
}

interface PreviewResult {
  plan: RestorePlan;
  generatedAt: string;
  commitSha: string;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function countActions(items: { action: string }[]) {
  const c = { create: 0, update: 0, unchanged: 0 };
  for (const i of items) {
    if (i.action === "create") c.create++;
    else if (i.action === "update") c.update++;
    else c.unchanged++;
  }
  return c;
}

export function GitHubPanel({
  config,
  onChanged,
  flash,
}: {
  config: GitHubConfigPublic | null;
  onChanged: () => void;
  flash: (msg: string) => void;
}) {
  const cfg = config;
  const [owner, setOwner] = useState(cfg?.owner ?? "");
  const [repo, setRepo] = useState(cfg?.repo ?? "");
  const [branch, setBranch] = useState(cfg?.branch ?? "main");
  const [pathPrefix, setPathPrefix] = useState(cfg?.pathPrefix ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<
    null | "test" | "save" | "backup" | "preview" | "restore" | "auto"
  >(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configured = cfg?.configured ?? false;
  const autoBackup = cfg?.autoBackup ?? false;
  const canConnect = owner.trim() !== "" && repo.trim() !== "";

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await sendJSON("/api/github/config", "PUT", {
        owner,
        repo,
        branch,
        pathPrefix,
        autoBackup,
        token: token || undefined,
      });
      setToken("");
      flash("GitHub settings saved");
      onChanged();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      const r = await sendJSON<{ ok: boolean } & TestResult>(
        "/api/github/test",
        "POST",
        { owner, repo, branch, token: token || undefined },
      );
      setTest(r);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function backupNow() {
    setBusy("backup");
    setError(null);
    try {
      const r = await sendJSON<{ commitSha: string }>("/api/github/backup", "POST");
      flash(`Backed up — ${r.commitSha.slice(0, 7)}`);
      onChanged();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function setAuto(v: boolean) {
    setBusy("auto");
    setError(null);
    try {
      await sendJSON("/api/github/config", "PUT", {
        owner: cfg?.owner,
        repo: cfg?.repo,
        branch: cfg?.branch,
        pathPrefix: cfg?.pathPrefix,
        autoBackup: v,
      });
      onChanged();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    setBusy("preview");
    setError(null);
    setPreview(null);
    try {
      setPreview(await getJSON<PreviewResult>("/api/github/restore"));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyRestore() {
    if (
      !confirm(
        "Restore overwrites local items that share a name with the backup. " +
          "Secrets you already have locally are preserved, and nothing is deleted. Continue?",
      )
    )
      return;
    setBusy("restore");
    setError(null);
    try {
      await sendJSON("/api/github/restore", "POST");
      setPreview(null);
      flash("Restored from backup");
      onChanged();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  const sc = preview ? countActions(preview.plan.servers) : null;
  const ac = preview ? countActions(preview.plan.subagents) : null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">GitHub Backup</h2>
        {configured ? (
          <Badge tone="info">
            {cfg?.owner}/{cfg?.repo}
          </Badge>
        ) : (
          <Badge tone="muted">not configured</Badge>
        )}
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Back up servers, subagents &amp; instructions to a GitHub repo.{" "}
        <span className="font-medium">Secrets are redacted</span> — env/header
        values never leave this machine.
      </p>

      {/* Connection */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner">
            <input
              className={inputClass}
              value={owner}
              placeholder="your-username"
              onChange={(e) => setOwner(e.target.value)}
            />
          </Field>
          <Field label="Repository">
            <input
              className={inputClass}
              value={repo}
              placeholder="dotfiles-backup"
              onChange={(e) => setRepo(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Branch">
            <input
              className={inputClass}
              value={branch}
              placeholder="main"
              onChange={(e) => setBranch(e.target.value)}
            />
          </Field>
          <Field label="Path prefix" hint="optional sub-directory">
            <input
              className={inputClass}
              value={pathPrefix}
              placeholder="(repo root)"
              onChange={(e) => setPathPrefix(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Personal Access Token"
          hint="classic: repo · fine-grained: Contents read & write. Stored locally, never pushed."
        >
          <input
            className={cn(inputClass, "font-mono")}
            type="password"
            autoComplete="off"
            value={token}
            placeholder={
              cfg?.tokenHint
                ? `${cfg.tokenHint} (saved — leave blank to keep)`
                : "ghp_… or github_pat_…"
            }
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={testConnection}
            disabled={busy !== null || !canConnect}
          >
            {busy === "test" ? "Testing…" : "Test"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            disabled={busy !== null || !canConnect}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          {test && (
            <Badge tone={test.canPush ? "ok" : "warn"}>
              {test.canPush ? "✓" : "⚠"} default: {test.defaultBranch} ·{" "}
              {test.canPush ? "push ok" : "no push permission"} ·{" "}
              {test.branchExists ? "branch exists" : "branch will be created"}
            </Badge>
          )}
        </div>
      </div>

      {/* Backup */}
      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={backupNow}
            disabled={busy !== null || !configured}
          >
            {busy === "backup" ? "Backing up…" : "Backup now"}
          </Button>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <Toggle
              checked={autoBackup}
              onChange={setAuto}
              label="auto-backup after each sync"
            />
            Auto-backup after each sync
          </label>
        </div>
        {cfg?.lastBackup && (
          <p className="mt-2 text-xs text-zinc-500">
            Last backup: {new Date(cfg.lastBackup.at).toLocaleString()} ·{" "}
            {cfg.lastBackup.counts.servers} servers,{" "}
            {cfg.lastBackup.counts.subagents} subagents ·{" "}
            <a
              className="text-blue-600 hover:underline dark:text-blue-400"
              href={cfg.lastBackup.commitUrl}
              target="_blank"
              rel="noreferrer"
            >
              {cfg.lastBackup.commitSha.slice(0, 7)}
            </a>
          </p>
        )}
      </div>

      {/* Restore */}
      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Restore</h3>
          <Button
            variant="default"
            size="sm"
            onClick={runPreview}
            disabled={busy !== null || !configured}
          >
            {busy === "preview" ? "Loading…" : "Preview restore"}
          </Button>
        </div>

        {preview && sc && ac && (
          <div className="mt-3 space-y-2 rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-950">
            <p className="text-zinc-500">
              Backup from {new Date(preview.generatedAt).toLocaleString()} (
              {preview.commitSha.slice(0, 7)})
            </p>
            <p>
              <span className="font-medium">Servers:</span> {sc.create} new,{" "}
              {sc.update} updated, {sc.unchanged} unchanged ·{" "}
              <span className="font-medium">Subagents:</span> {ac.create} new,{" "}
              {ac.update} updated, {ac.unchanged} unchanged ·{" "}
              <span className="font-medium">Instructions:</span>{" "}
              {preview.plan.instructions.action}
            </p>
            {preview.plan.agents.some((a) => a.changed) && (
              <p>
                <span className="font-medium">Agent toggles:</span>{" "}
                {preview.plan.agents
                  .filter((a) => a.changed)
                  .map((a) => `${a.key}→${a.to ? "on" : "off"}`)
                  .join(", ")}
              </p>
            )}
            {(preview.plan.localOnly.servers.length > 0 ||
              preview.plan.localOnly.subagents.length > 0) && (
              <p className="text-zinc-500">
                Kept (not in backup, never deleted):{" "}
                {[
                  ...preview.plan.localOnly.servers,
                  ...preview.plan.localOnly.subagents,
                ].join(", ")}
              </p>
            )}
            {preview.plan.warnings.map((w, i) => (
              <p key={i} className="text-amber-600 dark:text-amber-400">
                ⚠ {w}
              </p>
            ))}
            <div className="pt-1">
              <Button
                variant="danger"
                size="sm"
                onClick={applyRestore}
                disabled={busy !== null}
              >
                {busy === "restore" ? "Restoring…" : "Apply restore"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </Card>
  );
}
