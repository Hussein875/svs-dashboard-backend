#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WATCHER_DIR="$ROOT/code/UX-Watcher"
DASHBOARD_DIR="$ROOT/code/SVS-Dashboard"
ENV_FILE="$WATCHER_DIR/.env"
DASHBOARD_PORT="${DASHBOARD_PORT:-8765}"
ASSIGN_PORT="${ASSIGN_PORT:-3080}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE fehlt. Einmalig ausführen:"
  echo "   bash scripts/setup-local-env.sh"
  exit 1
fi

if [[ ! -d "$WATCHER_DIR/node_modules" ]]; then
  echo "⏳ npm install in UX-Watcher..."
  (cd "$WATCHER_DIR" && npm install)
fi

cleanup() {
  [[ -n "${ASSIGN_PID:-}" ]] && kill "$ASSIGN_PID" 2>/dev/null || true
  [[ -n "${HTTP_PID:-}" ]] && kill "$HTTP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export ASSIGN_PORT
export ASSIGN_CORS_ORIGIN="${ASSIGN_CORS_ORIGIN:-http://localhost:${DASHBOARD_PORT},http://127.0.0.1:${DASHBOARD_PORT}}"

# Lokal: API auf dem Mac; sonst Dashboard nutzt die VPS-API (siehe script.js).
export DEFAULT_ASSIGN_API_URL="${DEFAULT_ASSIGN_API_URL:-http://localhost:${ASSIGN_PORT}}"

echo "▶ Assign-API auf http://localhost:${ASSIGN_PORT}"
(cd "$WATCHER_DIR" && node assign-server.js) &
ASSIGN_PID=$!
sleep 1

echo "▶ Dashboard auf http://localhost:${DASHBOARD_PORT}"
(cd "$DASHBOARD_DIR" && python3 -m http.server "$DASHBOARD_PORT") &
HTTP_PID=$!

echo ""
echo "✅ Lokal bereit:"
echo "   http://localhost:${DASHBOARD_PORT}"
echo "   PIN: ${ADMIN_PIN:-????}"
echo ""
echo "Strg+C zum Beenden."

wait
