import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync/engine";
import { AGENT_KEYS, type AgentKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { dryRun?: boolean; only?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — default to full live sync
  }

  const only = body.only?.filter((k): k is AgentKey =>
    AGENT_KEYS.includes(k as AgentKey),
  );

  try {
    const results = syncAll({ dryRun: body.dryRun ?? false, only });
    return NextResponse.json({ results, dryRun: body.dryRun ?? false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
