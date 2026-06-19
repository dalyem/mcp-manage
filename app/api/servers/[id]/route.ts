import { NextResponse } from "next/server";
import {
  deleteServer,
  getServer,
  setServerEnabled,
  updateServer,
  validateServerInput,
  type ServerInput,
} from "@/lib/data";
import { syncAll } from "@/lib/sync/engine";
import { maybeAutoBackup } from "@/lib/github/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (!getServer(id))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: ServerInput & { enabledOnly?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    // Lightweight enable/disable toggle path.
    if (body.enabledOnly) {
      setServerEnabled(id, body.enabled ?? true);
    } else {
      const err = validateServerInput(body);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      updateServer(id, body);
    }
    const results = syncAll();
    maybeAutoBackup();
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
    deleteServer(id);
    // owned-set cleanup runs here: the removed server drops out of "desired".
    const results = syncAll();
    maybeAutoBackup();
    return NextResponse.json({ id, results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
