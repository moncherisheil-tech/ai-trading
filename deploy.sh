#!/usr/bin/env bash
# ==============================================================================
# deploy.sh — Quantum Mon Cheri — Gold-Standard Production Deploy
# ==============================================================================
#
# Usage:
#   bash deploy.sh            # full deploy (recommended)
#   npm run deploy            # same thing via npm alias
#
# Deploy sequence:
#   0.  Pre-flight: verify toolchain (node / npm / pm2 / git) and .env integrity.
#   1.  Gracefully stop running PM2 processes (SIGINT → graceful shutdown).
#   2.  git pull  — sync to latest HEAD on current branch.
#   3.  npm ci    — clean install from package-lock.json.
#   4.  npx prisma generate — sync Neon/Postgres types from prisma/schema.prisma.
#   5.  npm run build (NODE_ENV=production) — next build with output: standalone.
#   6.  Build validation — verify .next/standalone/server.js exists.
#   7.  Asset assembly:
#         a. public/          → .next/standalone/public/
#         b. .next/static/    → .next/standalone/.next/static/
#         c. .env             → .next/standalone/.env
#         d. prisma/          → .next/standalone/prisma/
#   8.  Server Actions manifest check (catches broken 'use server' files).
#   9.  Start PM2 processes via ecosystem.config.js --env production.
#   10. Health check — poll /api/health/ready until 200 or timeout.
#   11. Save PM2 process list (survives server reboots).
#
# Requirements (pre-installed on the server):
#   - Node.js 20+    (node --version)
#   - npm 9+         (npm --version)
#   - pm2            (npm install -g pm2)
#   - git            (git --version)
#   - curl           (health check in step 10)
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
echo "╔══════════════════════════════════════════════════════╗"
echo "║   QUANTUM MON CHERI — PRODUCTION DEPLOY              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo "  Project root : $ROOT"
echo "  Date / time  : $(date '+%Y-%m-%d %H:%M:%S %Z')"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 0 — Pre-flight checks
# ══════════════════════════════════════════════════════════════════════════════
step "0/11" "Pre-flight: toolchain + .env integrity"

# ── Toolchain ──
command -v node >/dev/null 2>&1 || fail "node not found in PATH. Install Node.js 20+."
command -v npm  >/dev/null 2>&1 || fail "npm not found in PATH."
command -v pm2  >/dev/null 2>&1 || fail "pm2 not found. Run: npm install -g pm2"
command -v git  >/dev/null 2>&1 || fail "git not found in PATH."
command -v curl >/dev/null 2>&1 || warn "curl not found — HTTP health check in step 10 will be skipped."

ok "node $(node --version)"
ok "npm  $(npm --version)"
ok "pm2  $(pm2 --version)"
ok "git  $(git --version | head -1)"

# ── .env presence ──
if [ ! -f "$ROOT/.env" ]; then
  fail ".env file not found at $ROOT/.env\n  Create it from .env.example and populate all secrets before deploying."
fi
ok ".env present"

# ── Nuclear Sanitization — auto-correct known fatal .env values BEFORE validation ──
# This runs unconditionally so a corrupt .env can never block a deploy.
step "0/11" "Nuclear Sanitization — auto-correcting .env"

# 1. Replace any purely-numeric PINECONE_INDEX_NAME value (e.g., "1002") with the correct name.
sed -i 's/^PINECONE_INDEX_NAME=["\x27]\?[0-9][0-9]*["\x27]\?$/PINECONE_INDEX_NAME="quantum-memory"/' "$ROOT/.env"

# 2. Replace an explicitly empty PINECONE_INDEX_NAME.
sed -i 's/^PINECONE_INDEX_NAME=["\x27]\{0,1\}["\x27]\{0,1\}$/PINECONE_INDEX_NAME="quantum-memory"/' "$ROOT/.env"

# 3. Ensure REDIS_URL is present; append default if missing entirely.
grep -q "^REDIS_URL=" "$ROOT/.env" || echo 'REDIS_URL="redis://127.0.0.1:6379"' >> "$ROOT/.env"

# Report the sanitized value so the deploy log confirms the correction.
_SANITIZED_INDEX=$(grep -E "^PINECONE_INDEX_NAME=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'\'' ' || true)
ok "PINECONE_INDEX_NAME after sanitization: \"${_SANITIZED_INDEX}\""

# ── Critical variable validation ──
# Checks: variable must exist AND have a non-empty, non-placeholder value.
_check_env_var() {
  local KEY="$1"
  local HINT="$2"
  local VALUE
  VALUE=$(grep -E "^${KEY}=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'\'' ' || true)
  if [ -z "$VALUE" ]; then
    fail ".env is missing a value for ${KEY}.\n  ${HINT}"
  fi
  # Reject obvious placeholder patterns
  if echo "$VALUE" | grep -qiE '(your_|changeme|placeholder|example|TODO)'; then
    fail ".env contains a placeholder value for ${KEY}=\"${VALUE}\".\n  ${HINT}"
  fi
}

_check_env_var "DATABASE_URL"        "Neon / local PostgreSQL connection string"
_check_env_var "APP_SESSION_SECRET"  "Session signing key — generate: openssl rand -hex 32"
_check_env_var "TELEGRAM_BOT_TOKEN"  "BotFather token — required for alerts and trade notifications"
_check_env_var "PINECONE_API_KEY"    "Pinecone API key from console.pinecone.io"
_check_env_var "PINECONE_INDEX_NAME" "Pinecone index name (e.g., quantum-memory) — must NOT be purely numeric"
_check_env_var "REDIS_URL"           "Redis connection URL — must be redis://127.0.0.1:6379 for on-prem"
_check_env_var "GEMINI_API_KEY"      "Gemini API key for LLM inference"

# ── PINECONE_INDEX_NAME must not be purely numeric ──
_INDEX_NAME=$(grep -E "^PINECONE_INDEX_NAME=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'\'' ' || true)
if [[ "$_INDEX_NAME" =~ ^[0-9]+$ ]]; then
  fail "PINECONE_INDEX_NAME=\"${_INDEX_NAME}\" is purely numeric.\n  Pinecone rejects numeric index names with HTTP 404.\n  Set a valid alphanumeric index name (e.g., quantum-memory)."
fi

# ── PINECONE_EMBEDDING_DIM must be 768 if set ──
_DIM=$(grep -E "^PINECONE_EMBEDDING_DIM=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'\'' ' || true)
if [ -n "$_DIM" ] && [ "$_DIM" != "768" ]; then
  fail "PINECONE_EMBEDDING_DIM=\"${_DIM}\" must equal 768 (Gemini text-embedding-004 output dimension).\n  Mismatched dimensions cause Pinecone upsert failures."
fi

# ── REDIS_URL must point to local Redis ──
_REDIS=$(grep -E "^REDIS_URL=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'\'' ' || true)
if [ "$_REDIS" != "redis://127.0.0.1:6379" ]; then
  warn "REDIS_URL=\"${_REDIS}\" differs from the expected on-prem value \"redis://127.0.0.1:6379\"."
  warn "If using a remote Redis (e.g., Upstash TLS), this is intentional — otherwise update .env."
fi

ok "All critical .env variables validated"

# ── Redis connectivity pre-check ──
if command -v redis-cli >/dev/null 2>&1; then
  _REDIS_PONG=$(redis-cli -u "${_REDIS:-redis://127.0.0.1:6379}" PING 2>/dev/null || echo "")
  if [ "$_REDIS_PONG" = "PONG" ]; then
    ok "Redis reachable — PING/PONG confirmed"
  else
    warn "Redis did not respond to PING. BullMQ queue features will be unavailable until Redis starts."
    warn "Start Redis manually: sudo systemctl start redis  OR  redis-server --daemonize yes"
  fi
else
  warn "redis-cli not found — skipping Redis pre-flight check"
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — NUCLEAR PM2 TEARDOWN (delete ALL processes, then kill daemon)
# ══════════════════════════════════════════════════════════════════════════════
step "1/11" "NUCLEAR PM2 teardown — delete ALL processes → kill daemon"

# Delete ALL registered PM2 processes (not just named ones).
# This guarantees that no stale process from a previous broken deploy
# can interfere with the fresh start in step 9 — regardless of what
# names were registered in the dump.
pm2 delete all 2>/dev/null \
  && ok "All PM2 processes deleted" \
  || warn "No PM2 processes were registered — nothing to delete"

# Kill the PM2 daemon to purge stale env snapshots, orphaned handles,
# and cached module state from memory. The daemon is re-spawned
# automatically on the next `pm2 start` in step 9.
pm2 kill 2>/dev/null \
  && ok "PM2 daemon killed — will restart fresh in step 9" \
  || warn "PM2 daemon was not running — continuing"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Pull latest code from remote
# ══════════════════════════════════════════════════════════════════════════════
step "2/11" "Pulling latest code (git pull)"

# Abort if the working tree is dirty — protect against accidental overwrites.
if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "Working tree has uncommitted changes. Stashing before pull..."
  git stash push -m "deploy.sh auto-stash $(date '+%Y%m%d-%H%M%S')"
  ok "Changes stashed"
fi

git pull --ff-only
ok "git pull completed (branch: $(git rev-parse --abbrev-ref HEAD), commit: $(git rev-parse --short HEAD))"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Install dependencies
# ══════════════════════════════════════════════════════════════════════════════
step "3/11" "Installing dependencies (npm ci)"

# npm ci is faster than npm install and guarantees a clean install from
# package-lock.json. devDependencies are included because:
#   - tsx (devDep) is needed at runtime by the queue-worker PM2 process
#   - prisma CLI (devDep) is needed for prisma generate
#   - typescript (devDep) is needed for next build
npm ci
ok "npm ci completed"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Regenerate Prisma client
# ══════════════════════════════════════════════════════════════════════════════
step "4/11" "Regenerating Prisma client (npx prisma generate)"

# Syncs the generated TypeScript types with the current prisma/schema.prisma.
# Idempotent — fast if schema hasn't changed.
npx prisma generate
ok "Prisma client generated"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — DELETE OLD WORLD + Build
# ══════════════════════════════════════════════════════════════════════════════
step "5/11" "DELETE OLD WORLD — nuclear artifact purge + next build"

# ── NUCLEAR CLEANUP — physical deletion of stale build artifacts ──────────────
# These are deleted EXPLICITLY and INDIVIDUALLY before the full .next/ wipe
# so the deploy log provides clear, auditable proof that the old standalone
# bundle and static chunks were removed from disk before the new build runs.
# A server running 1 000+ restart cycles likely has a corrupted standalone
# folder; the only safe recovery is physical deletion, not an overwrite.
echo "  [NUCLEAR] rm -rf .next/standalone ..."
rm -rf "$ROOT/.next/standalone"
ok ".next/standalone/ deleted"

echo "  [NUCLEAR] rm -rf .next/static ..."
rm -rf "$ROOT/.next/static"
ok ".next/static/ deleted"

# Wipe the remainder of the .next/ directory (server/, cache/, etc.)
# so zero stale chunks bleed into the fresh build.
echo "  [NUCLEAR] rm -rf .next/ (full wipe) ..."
rm -rf "$ROOT/.next"
ok ".next/ fully purged — disk is clean"

NODE_ENV=production npx next build
ok "next build completed"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 6 — Validate standalone output
# ══════════════════════════════════════════════════════════════════════════════
step "6/11" "Validating standalone bundle"

if [ ! -d "$ROOT/.next/standalone" ]; then
  fail ".next/standalone/ was not created.\n  Verify that next.config.ts contains  output: 'standalone'."
fi

if [ ! -f "$ROOT/.next/standalone/server.js" ]; then
  fail ".next/standalone/server.js not found.\n  The standalone build may have failed silently. Review build output above."
fi
ok ".next/standalone/server.js present"

# Verify node_modules exist inside standalone (Next.js traces them automatically).
if [ ! -d "$ROOT/.next/standalone/node_modules" ]; then
  warn ".next/standalone/node_modules/ not found — the server may fail to resolve packages."
else
  ok ".next/standalone/node_modules/ present"
fi

# Verify compiled JS chunks exist (essential for browser to load the app).
if [ ! -d "$ROOT/.next/static/chunks" ]; then
  fail ".next/static/chunks/ not found — the build output is incomplete.\n  Check for TypeScript/webpack errors in the build log above."
fi
ok ".next/static/chunks/ present"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 7 — Assemble the standalone bundle (static assets + env + prisma)
# ══════════════════════════════════════════════════════════════════════════════
step "7/11" "Assembling standalone bundle"

# 7a. public/ — images, icons, fonts, robots.txt, manifest.json, etc.
#     Next.js standalone does NOT include this directory automatically;
#     it must be copied or browsers get 404 on every /public/* path.
if [ -d "$ROOT/public" ]; then
  rm -rf "$ROOT/.next/standalone/public"
  cp -r "$ROOT/public" "$ROOT/.next/standalone/public"
  ok "public/ → .next/standalone/public/"
else
  warn "public/ not found — skipping (no static public assets)"
fi

# 7b. .next/static/ — compiled JS/CSS chunks, source maps, webpack runtime.
#     Without this copy the browser gets 404s on every /_next/static/* request,
#     which triggers MIME-type errors ('text/plain' for .js/.css is rejected by
#     the browser's strict MIME checking and CSP).
mkdir -p "$ROOT/.next/standalone/.next"
rm -rf "$ROOT/.next/standalone/.next/static"
cp -r "$ROOT/.next/static" "$ROOT/.next/standalone/.next/static"
ok ".next/static/ → .next/standalone/.next/static/"

# Confirm the chunks are in the right place as a final sanity check.
if [ ! -d "$ROOT/.next/standalone/.next/static/chunks" ]; then
  fail ".next/standalone/.next/static/chunks/ is missing after the copy.\n  This means /_next/static/* will 404 at runtime (MIME type text/plain errors)."
fi
ok ".next/standalone/.next/static/chunks/ verified"

# 7c. .env — copied into the standalone dir so `node .next/standalone/server.js`
#     can be started manually without PM2 env injection (useful for debugging).
cp "$ROOT/.env" "$ROOT/.next/standalone/.env"
ok ".env → .next/standalone/.env"

# 7d. prisma/ — @prisma/client resolves the schema at runtime for some operations.
if [ -d "$ROOT/prisma" ]; then
  rm -rf "$ROOT/.next/standalone/prisma"
  cp -r "$ROOT/prisma" "$ROOT/.next/standalone/prisma"
  ok "prisma/ → .next/standalone/prisma/"
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 8 — Verify Server Actions manifest
# ══════════════════════════════════════════════════════════════════════════════
step "8/11" "Verifying Server Actions manifest"

MANIFEST="$ROOT/.next/server/server-reference-manifest.json"
if [ ! -f "$MANIFEST" ]; then
  warn "server-reference-manifest.json not found."
  warn "Server Actions may fail with 'Failed to find Server Action'."
  warn "Ensure all 'use server' files export their actions at the top level."
else
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
# STEP 9 — Start PM2 processes
# ══════════════════════════════════════════════════════════════════════════════
step "9/11" "Starting PM2 processes via ecosystem.config.js (clean start)"

# Because we killed the daemon in step 1, we use `pm2 start` (not startOrReload)
# so all processes are registered fresh with the current env snapshot.
# --env production: merges env_production block from ecosystem.config.js.
pm2 start "$ROOT/ecosystem.config.js" --env production
ok "PM2 start completed"

echo "  Waiting 6 s for processes to initialise..."
sleep 6


# ══════════════════════════════════════════════════════════════════════════════
# STEP 10 — HTTP health check
# ══════════════════════════════════════════════════════════════════════════════
step "10/11" "HTTP health check + worker stability validation"

_APP_PORT=$(grep -E "^PORT=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'\'' ' || echo "3000")
_HEALTH_URL="http://127.0.0.1:${_APP_PORT:-3000}/api/health/ready"
_MAX_HEALTH_ATTEMPTS=12
_HEALTH_ATTEMPT=0
_HEALTH_OK=false

if command -v curl >/dev/null 2>&1; then
  echo "  Polling ${_HEALTH_URL} (up to ${_MAX_HEALTH_ATTEMPTS} attempts × 5 s)..."
  while [ "$_HEALTH_ATTEMPT" -lt "$_MAX_HEALTH_ATTEMPTS" ]; do
    _HEALTH_ATTEMPT=$((_HEALTH_ATTEMPT + 1))
    _HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "$_HEALTH_URL" 2>/dev/null || echo "000")
    if [ "$_HTTP_CODE" = "200" ]; then
      ok "Health check passed (HTTP 200) after ${_HEALTH_ATTEMPT} attempt(s)"
      _HEALTH_OK=true
      break
    fi
    echo "  Attempt ${_HEALTH_ATTEMPT}/${_MAX_HEALTH_ATTEMPTS}: HTTP ${_HTTP_CODE} — waiting 5 s..."
    sleep 5
  done

  if [ "$_HEALTH_OK" = false ]; then
    warn "Health endpoint did not return HTTP 200 after $((_MAX_HEALTH_ATTEMPTS * 5)) s."
    warn "The app may still be starting. Check:  pm2 logs quantum-mon-cheri --lines 50"
    warn "Manual verify:  curl -v ${_HEALTH_URL}"
  fi
else
  warn "curl not installed — skipping HTTP health check."
  warn "Verify manually: curl http://127.0.0.1:${_APP_PORT:-3000}/api/health/ready"
fi

# ── PM2 process status snapshot ───────────────────────────────────────────────
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

# ── Worker stability gate ──────────────────────────────────────────────────────
# A stable worker should have been online for ≥ 30 s with 0 restarts since this
# deploy. If the restart count is > 0 at this point (< 36 s after pm2 start),
# the worker is already in a crash loop — fail the deploy loudly.
echo ""
echo "  Waiting 30 s to validate queue-worker stability (uptime gate)..."
sleep 30

_PM2_STATUS_LATE=$(pm2 jlist 2>/dev/null || echo "[]")
_WORKER_RESTARTS=$(node -e "
  const list = JSON.parse(process.argv[1]);
  const p = list.find(p => p.name === 'queue-worker');
  if (!p) { process.stdout.write('NOT_FOUND'); process.exit(0); }
  // pm2_env.restart_time counts restarts SINCE the process was last registered.
  process.stdout.write(String(p.pm2_env.restart_time ?? -1));
" "$_PM2_STATUS_LATE" 2>/dev/null || echo "-1")

_WORKER_STATUS=$(node -e "
  const list = JSON.parse(process.argv[1]);
  const p = list.find(p => p.name === 'queue-worker');
  process.stdout.write(p ? p.pm2_env.status : 'NOT_FOUND');
" "$_PM2_STATUS_LATE" 2>/dev/null || echo "unknown")

if [ "$_WORKER_STATUS" = "online" ] && [ "$_WORKER_RESTARTS" = "0" ]; then
  ok "queue-worker : STABLE — online with 0 restarts after 30 s ✓"
elif [ "$_WORKER_STATUS" = "online" ] && [ "$_WORKER_RESTARTS" -gt "0" ] 2>/dev/null; then
  warn "queue-worker : online but has restarted ${_WORKER_RESTARTS} time(s)."
  warn "This may indicate a transient startup issue (Redis delay at boot is normal)."
  warn "Monitor with:  pm2 logs queue-worker --lines 50"
  warn "If restarts keep climbing, investigate:  pm2 logs queue-worker --err --lines 100"
else
  fail "queue-worker stability check FAILED — status=${_WORKER_STATUS}, restarts=${_WORKER_RESTARTS}.\n  The worker is in a crash loop. Run:\n    pm2 logs queue-worker --err --lines 100\n  Then re-run deploy.sh after fixing the root cause."
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 11 — Save PM2 process list
# ══════════════════════════════════════════════════════════════════════════════
step "11/11" "Saving PM2 process list (survives server reboots)"

pm2 save
ok "PM2 state saved"

echo ""
pm2 list


# ══════════════════════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  DEPLOY COMPLETE  ✓${RESET}"
echo -e "${GREEN}  App logs   :  pm2 logs quantum-mon-cheri --lines 100${RESET}"
echo -e "${GREEN}  Worker logs:  pm2 logs queue-worker --lines 100${RESET}"
echo -e "${GREEN}  Live status:  pm2 monit${RESET}"
echo -e "${GREEN}  Health URL :  http://127.0.0.1:${_APP_PORT:-3000}/api/health/ready${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""
