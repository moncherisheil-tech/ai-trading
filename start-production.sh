#!/usr/bin/env bash
# start-production.sh — Launch the standalone Next.js server.
#
# Prerequisites:  npm run build:prod  (or bash scripts/build-prod.sh)
#
# This script does NOT reload PM2. Use `npm run build:production` when you
# need both a full build + PM2 hot-reload in one step.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Validate that the standalone bundle exists before attempting to start
if [ ! -f ".next/standalone/server.js" ]; then
  echo "ERROR: .next/standalone/server.js not found."
  echo "       Run  npm run build:prod  first to generate the standalone bundle."
  exit 1
fi

export NODE_ENV=production
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

echo ""
echo "Starting QUANTUM MON CHERI in production mode"
echo "  NODE_ENV : $NODE_ENV"
echo "  PORT     : $PORT"
echo "  HOSTNAME : $HOSTNAME"
echo ""

exec node .next/standalone/server.js
