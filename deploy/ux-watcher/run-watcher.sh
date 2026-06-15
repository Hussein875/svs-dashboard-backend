#!/bin/bash
set -euo pipefail

if [[ -f /secrets/ux-watcher.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /secrets/ux-watcher.env
  set +a
fi

export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-/secrets/google-sa.json}"
# Cron erbt Container-ENV nicht — Browser aus dem Playwright-Image nutzen.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

cd /app
exec node watcher.js
