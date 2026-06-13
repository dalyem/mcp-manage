import { NextResponse } from "next/server";
import { setAgentManage } from "@/lib/data";
import { syncAll } from "@/lib/sync/engine";
import { AGENT_KEYS, type AgentKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { key } = await params;
  if (!AGENT_KEYS.includes(key as AgentKey))
    return NextResponse.json({ error: "unknown agent" }, { status: 404 });

  let body: { manageEnabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    setAgentManage(key as AgentKey, body.manageEnabled ?? true);
    const results = syncAll();
    return NextResponse.json({ key, results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
