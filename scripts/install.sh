#!/usr/bin/env bash
#
# Install mcp-manage as an always-on systemd *user* service bound to 127.0.0.1.
# Idempotent: safe to re-run after pulling changes.
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MCP_MANAGE_PORT:-8722}"
cd "$PROJECT_DIR"

echo "[mcp-manage] project: $PROJECT_DIR"
echo "[mcp-manage] port:    $PORT"

echo "[mcp-manage] installing dependencies…"
npm install

echo "[mcp-manage] building…"
npm run build

# Resolve a STABLE Node bin dir. fnm's per-shell multishell path lives under
# /run/user/... and changes across reboots, so prefer the 'default' alias.
resolve_node_dir() {
  local d
  for d in \
    "${XDG_DATA_HOME:-$HOME/.local/share}/fnm/aliases/default/bin" \
    "$HOME/.fnm/aliases/default/bin"; do
    if [ -x "$d/node" ]; then echo "$d"; return; fi
  done
  dirname "$(readlink -f "$(command -v node)")"
}
NODE_BIN="$(resolve_node_dir)"
if [ ! -x "$NODE_BIN/node" ]; then
  echo "[mcp-manage] ERROR: could not find a node binary at $NODE_BIN" >&2
  exit 1
fi
echo "[mcp-manage] node bin: $NODE_BIN"

# PATH for the service: node bin (also holds claude/codex/gemini/opencode),
# ~/.local/bin (cursor-agent), then system dirs.
SERVICE_PATH="$NODE_BIN:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"

echo "[mcp-manage] writing $UNIT_DIR/mcp-manage.service"
sed -e "s#__PROJECT_DIR__#${PROJECT_DIR}#g" \
    -e "s#__NODE_BIN__#${NODE_BIN}#g" \
    -e "s#__PORT__#${PORT}#g" \
    -e "s#__PATH__#${SERVICE_PATH}#g" \
    "$PROJECT_DIR/systemd/mcp-manage.service" >"$UNIT_DIR/mcp-manage.service"

echo "[mcp-manage] enabling service…"
systemctl --user daemon-reload
systemctl --user enable --now mcp-manage.service

# Keep the service running after logout / across reboots without a login session.
loginctl enable-linger "$USER" >/dev/null 2>&1 || \
  echo "[mcp-manage] note: could not enable linger (run: sudo loginctl enable-linger $USER)"

echo
echo "[mcp-manage] up on http://127.0.0.1:${PORT}"
systemctl --user --no-pager status mcp-manage.service | head -n 12 || true
