#!/usr/bin/env bash
# build-prod.sh — Bulletproof standalone build for production deployment.
#
# Usage:  npm run build:prod
#         bash scripts/build-prod.sh
#
# What it does:
#   1. Wipes .next/ and any root-level standalone/ to guarantee a clean slate.
#   2. Runs `next build` which generates .next/standalone/ (output: 'standalone').
#   3. Copies public/ → .next/standalone/public/  (required for Next.js static assets).
#   4. Copies .next/static/ → .next/standalone/.next/static/  (required for JS/CSS chunks).
#   5. Verifies server-reference-manifest.json exists (Server Actions health check).
#
# After this script completes, run:  bash start-production.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── 1. Clean ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     QUANTUM MON CHERI — PROD BUILD       ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "[1/5] Cleaning build artifacts..."
rm -rf .next
# Also remove a root-level standalone/ if it was ever created by accident
rm -rf standalone
echo "      ✓ .next/ removed"

# ── 2. Build ──────────────────────────────────────────────────────────────────
echo ""
echo "[2/5] Running next build..."
npx next build
echo "      ✓ next build complete"

# ── 3. Validate standalone output ─────────────────────────────────────────────
echo ""
echo "[3/5] Validating standalone output..."
if [ ! -d ".next/standalone" ]; then
  echo "ERROR: .next/standalone/ was not created."
  echo "       Ensure next.config.ts has  output: 'standalone'"
  exit 1
fi
if [ ! -f ".next/standalone/server.js" ]; then
  echo "ERROR: .next/standalone/server.js not found."
  echo "       The standalone build may have failed silently."
  exit 1
fi
echo "      ✓ .next/standalone/server.js exists"

# ── 4. Copy public/ ───────────────────────────────────────────────────────────
echo ""
echo "[4/5] Copying static assets into standalone bundle..."
if [ -d "public" ]; then
  cp -r public .next/standalone/public
  echo "      ✓ public/ → .next/standalone/public/"
else
  echo "      ⚠ public/ directory not found — skipping"
fi

# Copy Next.js compiled static chunks (JS, CSS, images)
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static
echo "      ✓ .next/static/ → .next/standalone/.next/static/"

# ── 5. Verify server-reference-manifest.json (Server Actions) ─────────────────
echo ""
echo "[5/5] Verifying Server Actions manifest..."
MANIFEST=".next/server/server-reference-manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "WARNING: $MANIFEST not found."
  echo "         Server Actions may fail with 'Failed to find Server Action'."
  echo "         Check that app/actions.ts uses top-level 'use server' and all"
  echo "         actions are exported (not just defined)."
else
  ACTION_COUNT=$(python3 -c "import json,sys; d=json.load(open('$MANIFEST')); print(len(d.get('node',{}).get('actions',{})) + len(d.get('edge',{}).get('actions',{})))" 2>/dev/null || echo "N/A")
  echo "      ✓ server-reference-manifest.json found (actions registered: ${ACTION_COUNT})"
fi

# Summary
echo ""
echo "═══════════════════════════════════════════"
echo "  Build complete. Standalone bundle ready."
echo "  Start server:  bash start-production.sh"
echo "  Or with PM2:   npm run build:production"
echo "═══════════════════════════════════════════"
echo ""
