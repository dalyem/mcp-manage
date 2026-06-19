import { NextResponse } from "next/server";
import { getGitHubConfig, isConfigured } from "@/lib/github/config";
import { GitHubError, pullFiles } from "@/lib/github/client";
import { parseSnapshot } from "@/lib/github/snapshot";
import { applyRestore, previewRestore } from "@/lib/github/restore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notConfigured() {
  return NextResponse.json(
    { error: "GitHub is not configured — add a token and repo first" },
    { status: 400 },
  );
}

function fail(e: unknown) {
  const status = e instanceof GitHubError ? e.status : 500;
  return NextResponse.json(
    { error: e instanceof Error ? e.message : String(e) },
    { status },
  );
}

/** Preview (read-only): what a restore would change. */
export async function GET() {
  const cfg = getGitHubConfig();
  if (!isConfigured(cfg)) return notConfigured();
  try {
    const pulled = await pullFiles(cfg);
    if (!pulled)
      return NextResponse.json(
        { error: "no backup found on this branch yet" },
        { status: 404 },
      );
    const snapshot = parseSnapshot(pulled.files);
    return NextResponse.json({
      plan: previewRestore(snapshot),
      generatedAt: snapshot.generatedAt,
      commitSha: pulled.commitSha,
    });
  } catch (e) {
    return fail(e);
  }
}

/** Apply the restore (merge into the DB, then sync to agent files). */
export async function POST() {
  const cfg = getGitHubConfig();
  if (!isConfigured(cfg)) return notConfigured();
  try {
    const pulled = await pullFiles(cfg);
    if (!pulled)
      return NextResponse.json(
        { error: "no backup found on this branch yet" },
        { status: 404 },
      );
    const snapshot = parseSnapshot(pulled.files);
    const { plan, results } = applyRestore(snapshot);
    return NextResponse.json({ ok: true, plan, results, generatedAt: snapshot.generatedAt });
  } catch (e) {
    return fail(e);
  }
}
