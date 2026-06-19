import { NextResponse } from "next/server";
import {
  createServer,
  listServers,
  validateServerInput,
  type ServerInput,
} from "@/lib/data";
import { syncAll } from "@/lib/sync/engine";
import { maybeAutoBackup } from "@/lib/github/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ servers: listServers() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let input: ServerInput;
  try {
    input = (await req.json()) as ServerInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const err = validateServerInput(input);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const id = createServer(input);
    const results = syncAll();
    maybeAutoBackup();
    return NextResponse.json({ id, results }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /unique/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
