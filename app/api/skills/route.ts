import { NextResponse } from "next/server";
import {
  createSkill,
  listSkills,
  validateSkillInput,
  type SkillInput,
} from "@/lib/data";
import { syncAll } from "@/lib/sync/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ skills: listSkills() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let input: SkillInput;
  try {
    input = (await req.json()) as SkillInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // req.json() happily returns null / primitives / arrays for valid JSON; reject
  // them up front so validateSkillInput only ever sees an object.
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return NextResponse.json(
      { error: "request body must be a JSON object" },
      { status: 400 },
    );
  }

  const err = validateSkillInput(input);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const id = createSkill(input);
    const results = syncAll();
    return NextResponse.json({ id, results }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /unique/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
