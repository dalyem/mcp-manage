import { NextResponse } from "next/server";
import { getInstructions, setInstructions } from "@/lib/data";
import { syncAll } from "@/lib/sync/engine";
import { maybeAutoBackup } from "@/lib/github/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ content: getInstructions() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    setInstructions(body.content ?? "");
    const results = syncAll();
    maybeAutoBackup();
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
