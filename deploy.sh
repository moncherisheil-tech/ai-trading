#!/usr/bin/env bash
# ==============================================================================
# deploy.sh — Quantum Mon Cheri — Bulletproof Production Deploy
# ==============================================================================
#
# Usage:
#   bash deploy.sh            # full deploy (recommended)
#   npm run deploy            # same thing via npm alias
#
# What this script does (in order):
#   0.  Pre-flight: verify node / npm / pm2 are available and .env exists.
#   1.  Gracefully stop the running PM2 processes (sends SIGINT, not SIGKILL).
#   2.  Install all dependencies (npm ci) and regenerate the Prisma client.
#   3.  Run `next build` in production mode.
#   4.  Validate that the standalone bundle was created correctly.
#   5.  Assemble the standalone bundle:
#         a. Copy public/          → .next/standalone/public/
#         b. Copy .next/static/   → .next/standalone/.next/static/
#         c. Copy .env            → .next/standalone/.env
#         d. Copy prisma/         → .next/standalone/prisma/
#   6.  Verify the Server Actions manifest (catches broken 'use server' files).
#   7.  Start both PM2 processes via ecosystem.config.js --env production.
#   8.  Health-check: confirm both processes reach 'online' status.
#   9.  Save PM2 process list so it survives server reboots.
#
# Requirements (must be pre-installed on the server):
#   - Node.js 20+
#   - npm 9+
#   - pm2 (npm install -g pm2)
#
# ==============================================================================
set -euo pipefail

# ── ANSI colours ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

step()  { echo -e "\n${BLUE}${BOLD}[$1]${RESET} $2"; }
ok()    { echo -e "    ${GREEN}✓${RESET}  $1"; }
warn()  { echo -e "    ${YELLOW}⚠${RESET}  $1"; }
fail()  { echo -e "\n${RED}${BOLD}✗  FATAL:${RESET} $1\n"; exit 1; }

# ── Resolve project root (script may be called from any cwd) ──────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════╗"
echo "║   QUANTUM MON CHERI — PRODUCTION DEPLOY          ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo "  Project root : $ROOT"
echo "  Date / time  : $(date '+%Y-%m-%d %H:%M:%S %Z')"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 0 — Pre-flight checks
# ══════════════════════════════════════════════════════════════════════════════
step "0/9" "Pre-flight checks"

command -v node >/dev/null 2>&1 || fail "node not found in PATH. Install Node.js 20+."
command -v npm  >/dev/null 2>&1 || fail "npm not found in PATH."
command -v pm2  >/dev/null 2>&1 || fail "pm2 not found. Run: npm install -g pm2"

ok "node $(node --version)"
ok "npm  $(npm --version)"
ok "pm2  $(pm2 --version)"

# Abort immediately if .env is missing — server.js and the worker both need it.
if [ ! -f "$ROOT/.env" ]; then
  fail ".env file not found at $ROOT/.env\n  Create it from .env.example and populate all secrets before deploying."
fi
ok ".env present"

# Sanity-check for a few critical variables (non-exhaustive — catches blank files).
_REQUIRED_VARS=("DATABASE_URL" "APP_SESSION_SECRET")
for _VAR in "${_REQUIRED_VARS[@]}"; do
  if ! grep -qE "^${_VAR}=.+" "$ROOT/.env" 2>/dev/null; then
    fail ".env is missing a value for ${_VAR}. Populate it before deploying."
  fi
done
ok "Critical .env variables present"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Stop current PM2 processes gracefully
# ══════════════════════════════════════════════════════════════════════════════
step "1/9" "Stopping PM2 processes gracefully (SIGINT → graceful shutdown)"

# `pm2 stop` sends SIGINT, which triggers the worker's shutdown() handler
# (closes BullMQ worker, QueueEvents, and IORedis before exiting).
# We ignore errors here in case a process isn't running yet.
pm2 stop quantum-mon-cheri 2>/dev/null \
  && ok "quantum-mon-cheri stopped" \
  || warn "quantum-mon-cheri was not running — skipping"

pm2 stop queue-worker 2>/dev/null \
  && ok "queue-worker stopped" \
  || warn "queue-worker was not running — skipping"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Install dependencies and regenerate Prisma client
# ══════════════════════════════════════════════════════════════════════════════
step "2/9" "Installing dependencies (npm ci)"

# npm ci is faster than npm install and guarantees a clean install from
# package-lock.json. devDependencies are included because:
#   - tsx (devDep) is needed at runtime by the queue-worker PM2 process
#   - prisma CLI (devDep) is needed for prisma generate
#   - typescript (devDep) is needed for next build
npm ci

# Regenerate the Prisma client to ensure the binary matches this platform.
# This is idempotent and fast (no network call if already generated).
npx prisma generate
ok "Prisma client generated"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Build
# ══════════════════════════════════════════════════════════════════════════════
step "3/9" "Running next build (output: standalone)"

# Wipe the previous build so stale chunks never bleed into the new deploy.
echo "  Removing .next/ ..."
rm -rf .next

NODE_ENV=production npx next build

ok "next build completed"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Validate standalone output
# ══════════════════════════════════════════════════════════════════════════════
step "4/9" "Validating standalone bundle"

if [ ! -d "$ROOT/.next/standalone" ]; then
  fail ".next/standalone/ was not created.\n  Check that next.config.ts contains  output: 'standalone'."
fi

if [ ! -f "$ROOT/.next/standalone/server.js" ]; then
  fail ".next/standalone/server.js not found.\n  The standalone build may have failed silently. Check build output above."
fi
ok ".next/standalone/server.js present"

# Verify node_modules exist inside standalone (Next.js traces them automatically)
if [ ! -d "$ROOT/.next/standalone/node_modules" ]; then
  warn ".next/standalone/node_modules/ not found — the server may fail to resolve packages."
else
  ok ".next/standalone/node_modules/ present"
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Assemble the standalone bundle
# ══════════════════════════════════════════════════════════════════════════════
step "5/9" "Assembling standalone bundle (static assets + env + prisma)"

# 5a. public/ — images, icons, fonts, robots.txt, manifest.json, etc.
#     Next.js standalone does NOT include this directory; it must be copied.
if [ -d "$ROOT/public" ]; then
  rm -rf "$ROOT/.next/standalone/public"
  cp -r "$ROOT/public" "$ROOT/.next/standalone/public"
  ok "public/ → .next/standalone/public/"
else
  warn "public/ not found — skipping (no static public assets)"
fi

# 5b. .next/static/ — compiled JS/CSS chunks, source maps, webpack runtime.
#     Without this copy the browser gets 404s on every /_next/static/* request,
#     which triggers MIME-type errors (text/plain for .js/.css is rejected by
#     the browser's strict MIME checking).
mkdir -p "$ROOT/.next/standalone/.next"
rm -rf "$ROOT/.next/standalone/.next/static"
cp -r "$ROOT/.next/static" "$ROOT/.next/standalone/.next/static"
ok ".next/static/ → .next/standalone/.next/static/"

# 5c. .env — the standalone server.js does not call dotenv automatically.
#     PM2 also reads it via env_file in ecosystem.config.js, but an explicit
#     copy ensures the standalone bundle is self-sufficient if started manually.
cp "$ROOT/.env" "$ROOT/.next/standalone/.env"
ok ".env → .next/standalone/.env"

# 5d. prisma/ — @prisma/client resolves the schema file relative to cwd at
#     runtime for some operations (e.g. introspection, migrations). Copying
#     the schema makes the standalone directory fully self-contained.
if [ -d "$ROOT/prisma" ]; then
  rm -rf "$ROOT/.next/standalone/prisma"
  cp -r "$ROOT/prisma" "$ROOT/.next/standalone/prisma"
  ok "prisma/ → .next/standalone/prisma/"
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 6 — Verify Server Actions manifest
# ══════════════════════════════════════════════════════════════════════════════
step "6/9" "Verifying Server Actions manifest"

MANIFEST="$ROOT/.next/server/server-reference-manifest.json"
if [ ! -f "$MANIFEST" ]; then
  warn "server-reference-manifest.json not found."
  warn "Server Actions may fail with 'Failed to find Server Action'."
  warn "Ensure all 'use server' files export their actions at the top level."
else
  # Count registered actions without requiring python3
  ACTION_COUNT=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('$MANIFEST', 'utf8'));
      const n = Object.keys(d.node?.actions ?? {}).length;
      const e = Object.keys(d.edge?.actions ?? {}).length;
      console.log(n + e);
    } catch { console.log('N/A'); }
  " 2>/dev/null || echo "N/A")
  ok "server-reference-manifest.json present (actions registered: ${ACTION_COUNT})"
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 7 — Start PM2 processes
# ══════════════════════════════════════════════════════════════════════════════
step "7/9" "Starting PM2 processes via ecosystem.config.js"

# startOrReload: starts if not running, hot-reloads if already up.
# --update-env: forces PM2 to re-read env_file and env_production on reload
#               (without this flag, PM2 reuses cached env on a hot-reload).
pm2 startOrReload "$ROOT/ecosystem.config.js" --env production --update-env

ok "PM2 startOrReload completed"

# Brief grace period so both processes can reach 'online' status before we poll.
echo "  Waiting 5 s for processes to stabilise..."
sleep 5


# ══════════════════════════════════════════════════════════════════════════════
# STEP 8 — Health check
# ══════════════════════════════════════════════════════════════════════════════
step "8/9" "Health check"

# Read PM2 process status using jlist (machine-readable JSON).
_PM2_STATUS=$(pm2 jlist 2>/dev/null || echo "[]")

_check_process() {
  local NAME="$1"
  local STATUS
  STATUS=$(node -e "
    const list = JSON.parse(process.argv[1]);
    const p = list.find(p => p.name === '${NAME}');
    process.stdout.write(p ? p.pm2_env.status : 'NOT_FOUND');
  " "$_PM2_STATUS" 2>/dev/null || echo "unknown")

  if [ "$STATUS" = "online" ]; then
    ok "${NAME} : online"
  else
    warn "${NAME} : ${STATUS}  (check: pm2 logs ${NAME} --lines 50)"
  fi
}

_check_process "quantum-mon-cheri"
_check_process "queue-worker"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 9 — Save PM2 state
# ══════════════════════════════════════════════════════════════════════════════
step "9/9" "Saving PM2 process list (survives server reboots)"

pm2 save
ok "PM2 state saved"

# Print a compact process table for a quick visual confirmation.
echo ""
pm2 list


# ══════════════════════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  DEPLOY COMPLETE  ✓${RESET}"
echo -e "${GREEN}  App logs   :  pm2 logs quantum-mon-cheri --lines 100${RESET}"
echo -e "${GREEN}  Worker logs:  pm2 logs queue-worker --lines 100${RESET}"
echo -e "${GREEN}  Live status:  pm2 monit${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${RESET}"
echo ""
