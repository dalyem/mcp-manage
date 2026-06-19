import { NextResponse } from "next/server";
import { getGitHubConfig, type GitHubConfig } from "@/lib/github/config";
import { GitHubError, testConnection } from "@/lib/github/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TestBody {
  owner?: string;
  repo?: string;
  branch?: string;
  token?: string;
}

export async function POST(req: Request) {
  let body: TestBody = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — test the stored config
  }

  const stored = getGitHubConfig();
  const cfg: GitHubConfig = {
    token: body.token?.trim() || stored?.token || "",
    owner: (body.owner ?? stored?.owner ?? "").trim(),
    repo: (body.repo ?? stored?.repo ?? "").trim(),
    branch: body.branch?.trim() || stored?.branch || "main",
    pathPrefix: stored?.pathPrefix ?? "",
    autoBackup: stored?.autoBackup ?? false,
    lastBackup: stored?.lastBackup ?? null,
  };

  if (!cfg.token)
    return NextResponse.json({ error: "enter a token to test" }, { status: 400 });
  if (!cfg.owner || !cfg.repo)
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });

  try {
    const info = await testConnection(cfg);
    return NextResponse.json({ ok: true, ...info });
  } catch (e) {
    const status = e instanceof GitHubError ? e.status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
