import { NextResponse } from "next/server";
import {
  deleteSubagent,
  getSubagent,
  setSubagentEnabled,
  updateSubagent,
  validateSubagentInput,
  type SubagentInput,
} from "@/lib/data";
import { syncAll } from "@/lib/sync/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (!getSubagent(id))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: SubagentInput & { enabledOnly?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    // Lightweight enable/disable toggle path.
    if (body.enabledOnly) {
      setSubagentEnabled(id, body.enabled ?? true);
    } else {
      const err = validateSubagentInput(body);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      updateSubagent(id, body);
    }
    const results = syncAll();
    return NextResponse.json({ id, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /unique/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  try {
    deleteSubagent(id);
    // owned-set cleanup runs here: the removed subagent drops out of "desired".
    const results = syncAll();
    return NextResponse.json({ id, results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
