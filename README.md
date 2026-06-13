# mcp-manage

One web UI to manage **MCP servers** and **global instruction files** across all
your AI coding agents on a machine — define a server (or a rule) once and it
propagates to **Claude Code, Codex CLI, Cursor CLI, Gemini CLI, and OpenCode**.

It runs as an always-on, localhost-only service. Front it with nginx + Tailscale
for remote access.

> **Scope (v1): global only.** Manages each agent's *global* MCP config and
> *global* instruction file. Per-project overrides are planned (the schema is
> built to extend into them).

## How it works

- **SQLite is the source of truth.** Each agent's config file is a *generated
  output*. Any change in the UI writes to SQLite and immediately **syncs** the
  affected agents.
- **Surgical, never destructive.** Every agent config holds far more than MCP
  servers (`~/.claude.json` is a huge state file; Codex/Gemini configs hold
  model/approval settings). The tool does a read-modify-write that touches only
  the MCP region and only the server entries it *owns* — your hand-added servers
  and unrelated settings are left untouched. It's a true no-op when nothing
  changed (so it won't reformat your files or strip Codex TOML comments
  needlessly).
- **Backups before every write**, with one-click restore, under
  `~/.local/share/mcp-manage/backups/`.
- **First-run import** adopts the MCP servers already configured in your agents.

### Where it writes

| Agent | MCP config | Global instructions |
|---|---|---|
| Claude Code | `~/.claude.json` (top-level `mcpServers`) | `~/.claude/CLAUDE.md` |
| Codex CLI | `~/.codex/config.toml` (`[mcp_servers.*]`) | `~/.codex/AGENTS.md` |
| Cursor CLI | `~/.cursor/mcp.json` | _(none — Cursor rules are UI-only)_ |
| Gemini CLI | `~/.gemini/settings.json` (`mcpServers`) | `~/.gemini/GEMINI.md` |
| OpenCode | `~/.config/opencode/opencode.json` (`mcp`) | `~/.config/opencode/AGENTS.md` |

Instruction files get a delimited managed block
(`<!-- BEGIN mcp-manage --> … <!-- END mcp-manage -->`); anything you write
outside the block is preserved.

## Install (systemd user service)

```bash
git clone <your-repo> ~/personal/mcp-manage
cd ~/personal/mcp-manage
./scripts/install.sh          # installs deps, builds, enables the service
```

The service binds to `127.0.0.1:8722` and survives logout/reboot
(`loginctl enable-linger`). Change the port with `MCP_MANAGE_PORT=9000 ./scripts/install.sh`.

Manage it:

```bash
systemctl --user status mcp-manage
systemctl --user restart mcp-manage
journalctl --user -u mcp-manage -f
```

## Remote access (nginx + Tailscale)

Keep the app bound to localhost and reverse-proxy it. Example nginx server block
serving it on your Tailscale hostname:

```nginx
server {
    listen 80;
    server_name devbox.your-tailnet.ts.net;

    location / {
        proxy_pass         http://127.0.0.1:8722;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   X-Forwarded-For $remote_addr;
    }
}
```

Because it's reachable only via Tailscale + localhost, no app-level auth is
included. Don't expose it to the public internet.

## Development

```bash
npm install
npm run dev        # http://127.0.0.1:8722
```

- `npm run build` / `npm start` — production build & serve
- `npm run db:migrate` — provision the SQLite DB (also self-bootstraps on boot)

State lives in `~/.local/share/mcp-manage/` (`mcp-manage.db` + `backups/`).
Override with `MCP_MANAGE_DATA_DIR`.

## Architecture

```
lib/
  agents/        per-agent adapters (pure config transforms) + registry
  sync/          engine (orchestration, owned-set cleanup), managed-block, diff
  db/            Drizzle schema + self-bootstrapping better-sqlite3 client
  backup/        pre-write backups + restore
  import/        first-run adopt of existing servers
  data.ts        DB CRUD used by the API
app/
  api/           route handlers (servers, agents, instructions, sync, status, backups)
  components/    dashboard UI (status, servers, instructions, backups)
```

Adapters are pure string-in/string-out transforms; all IO, backups, diffing and
DB bookkeeping live in the sync engine, which keeps the tricky per-agent format
logic isolated and testable.
