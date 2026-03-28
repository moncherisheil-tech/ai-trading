#!/usr/bin/env bash
# Zero-touch production build: clean cache, Next build, standalone static pack, PM2 reload with native env.
# `.env` is written by CI (GitHub Actions secrets); PM2 loads it via ecosystem `env_file` — do not source here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[build-production] Removing .next ..."
rm -rf .next

echo "[build-production] next build ..."
npx next build

echo "[build-production] Copy static assets into standalone output ..."
cp -r public .next/standalone/public
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static

echo "[build-production] PM2 startOrReload with --update-env ..."
pm2 startOrReload ecosystem.config.js --update-env

echo "[build-production] pm2 save ..."
pm2 save
