import { NextResponse } from "next/server";
import { getGitHubConfigPublic, saveGitHubConfig } from "@/lib/github/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ config: getGitHubConfigPublic() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

interface ConfigBody {
  owner?: string;
  repo?: string;
  branch?: string;
  pathPrefix?: string;
  autoBackup?: boolean;
  token?: string;
}

export async function PUT(req: Request) {
  let body: ConfigBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "request body must be a JSON object" },
      { status: 400 },
    );
  }

  if (typeof body.owner !== "string" || typeof body.repo !== "string")
    return NextResponse.json({ error: "owner and repo must be strings" }, { status: 400 });
  if (body.branch != null && typeof body.branch !== "string")
    return NextResponse.json({ error: "branch must be a string" }, { status: 400 });
  if (body.pathPrefix != null && typeof body.pathPrefix !== "string")
    return NextResponse.json({ error: "pathPrefix must be a string" }, { status: 400 });
  if (body.token != null && typeof body.token !== "string")
    return NextResponse.json({ error: "token must be a string" }, { status: 400 });
  if (body.autoBackup != null && typeof body.autoBackup !== "boolean")
    return NextResponse.json({ error: "autoBackup must be a boolean" }, { status: 400 });

  const owner = body.owner.trim();
  const repo = body.repo.trim();
  const token = (body.token ?? "").trim();
  if (!owner || !repo)
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  if (/[\s/]/.test(owner) || /[\s/]/.test(repo))
    return NextResponse.json(
      { error: "owner and repo must not contain spaces or slashes" },
      { status: 400 },
    );

  try {
    saveGitHubConfig({
      owner,
      repo,
      branch: body.branch?.trim() || "main",
      pathPrefix: body.pathPrefix ?? "",
      autoBackup: !!body.autoBackup,
      // An empty/whitespace/omitted token preserves the stored one.
      ...(token ? { token } : {}),
    });
    return NextResponse.json({ config: getGitHubConfigPublic() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
