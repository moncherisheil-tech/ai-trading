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
exec npx next build
