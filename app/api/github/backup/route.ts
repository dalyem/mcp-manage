import { NextResponse } from "next/server";
import { getGitHubConfig, isConfigured } from "@/lib/github/config";
import { performBackup } from "@/lib/github/backup";
import { GitHubError } from "@/lib/github/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const cfg = getGitHubConfig();
  if (!isConfigured(cfg))
    return NextResponse.json(
      { error: "GitHub is not configured — add a token and repo first" },
      { status: 400 },
    );

  try {
    const meta = await performBackup(cfg);
    return NextResponse.json({ ok: true, ...meta });
  } catch (e) {
    const status = e instanceof GitHubError ? e.status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
