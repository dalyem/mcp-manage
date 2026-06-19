import { NextResponse } from "next/server";
import {
  deleteSkill,
  getSkill,
  setSkillEnabled,
  updateSkill,
  validateSkillInput,
  type SkillInput,
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
  if (!getSkill(id))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: SkillInput & { enabledOnly?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // req.json() happily returns null / primitives / arrays for valid JSON; reject
  // them before reading properties like enabledOnly (mirrors the POST guard).
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "request body must be a JSON object" },
      { status: 400 },
    );
  }

  try {
    // Lightweight enable/disable toggle path.
    if (body.enabledOnly) {
      setSkillEnabled(id, body.enabled ?? true);
    } else {
      const err = validateSkillInput(body);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      updateSkill(id, body);
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
  if (!getSkill(id))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    deleteSkill(id);
    // owned-set cleanup runs here: the removed skill drops out of "desired",
    // so the next sync deletes its directory from each agent.
    const results = syncAll();
    return NextResponse.json({ id, results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
