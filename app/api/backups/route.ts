import { NextResponse } from "next/server";
import { listBackups } from "@/lib/data";
import { restoreBackup } from "@/lib/backup/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ backups: listBackups() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Number.isInteger(body.id))
    return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const result = restoreBackup(body.id as number);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
