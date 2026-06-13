import { NextResponse } from "next/server";
import { getStatus } from "@/lib/sync/engine";
import { listAgentsMeta } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const status = getStatus();
    const meta = listAgentsMeta();
    return NextResponse.json({ status, agents: meta });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
