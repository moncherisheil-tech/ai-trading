#!/usr/bin/env bash
# Production build: clear Next cache, load env, run next build.
# DATABASE_URL must use user quantum_admin in production (see lib/db/sovereign-db-url.ts).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  set -a
  # shellcheck source=/dev/null
  source "$f"
  set +a
}

if [[ -f .env.production ]]; then
  load_env_file .env.production
elif [[ -f .env ]]; then
  load_env_file .env
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[build-production] WARNING: DATABASE_URL is unset. Set it before build on the server."
fi

echo "[build-production] Removing .next (standalone cache) ..."
rm -rf .next

echo "[build-production] next build ..."
npx next build

echo "[build-production] Copy static assets into standalone output ..."
mkdir -p .next/standalone/.next
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

echo "[build-production] PM2: ecosystem.config.js with --update-env (reload if already running) ..."
if pm2 describe quantum-mon-cheri >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js --update-env
fi
pm2 save 2>/dev/null || true
