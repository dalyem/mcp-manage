import { NextResponse } from "next/server";
import {
  createSubagent,
  listSubagents,
  validateSubagentInput,
  type SubagentInput,
} from "@/lib/data";
import { syncAll } from "@/lib/sync/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ subagents: listSubagents() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let input: SubagentInput;
  try {
    input = (await req.json()) as SubagentInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const err = validateSubagentInput(input);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const id = createSubagent(input);
    const results = syncAll();
    return NextResponse.json({ id, results }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /unique/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
