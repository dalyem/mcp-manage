import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync/engine";
import { maybeAutoBackup } from "@/lib/github/backup";
import { AGENT_KEYS, type AgentKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { dryRun?: boolean; only?: string[] } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      body = parsed as { dryRun?: boolean; only?: string[] };
  } catch {
    // empty/invalid body is fine — default to full live sync
  }

  const only = body.only?.filter((k): k is AgentKey =>
    AGENT_KEYS.includes(k as AgentKey),
  );

  const dryRun = body.dryRun ?? false;
  try {
    const results = syncAll({ dryRun, only });
    if (!dryRun) maybeAutoBackup();
    return NextResponse.json({ results, dryRun });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
