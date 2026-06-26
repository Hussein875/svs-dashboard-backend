#!/usr/bin/env bash
# Lokale .env für vollständigen Test (Assign-API + UX auf dem Mac).
# UX-Zugangsdaten eintragen oder von /opt/secrets/ux-watcher.env kopieren.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/code/UX-Watcher/.env"
SA_FILE="$ROOT/ux-dashboard-465511-29cd7fce4011.json"
EXAMPLE="$ROOT/code/UX-Watcher/.env.example"

if [[ ! -f "$SA_FILE" ]]; then
  echo "❌ Service-Account fehlt: $SA_FILE"
  exit 1
fi

cp "$EXAMPLE" "$ENV_FILE"
{
  echo "GOOGLE_APPLICATION_CREDENTIALS=$SA_FILE"
  echo "ADMIN_PIN=2904"
  echo "JWT_SECRET=local-dev-secret"
  echo "ASSIGN_PORT=3080"
  echo "ASSIGN_CORS_ORIGIN=http://localhost:8765,http://127.0.0.1:8765"
} >> "$ENV_FILE"

chmod 600 "$ENV_FILE"
echo "✅ $ENV_FILE erstellt."
echo "   Bitte UX_CUSTOMER_NR und UX_PASSWORD in der Datei eintragen."
