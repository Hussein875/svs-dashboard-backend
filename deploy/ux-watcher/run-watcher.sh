#!/bin/bash
set -euo pipefail

if [[ -f /secrets/ux-watcher.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /secrets/ux-watcher.env
  set +a
fi

export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-/secrets/google-sa.json}"

cd /app
exec node watcher.js
