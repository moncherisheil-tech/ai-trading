/**
 * PM2 Ecosystem — Production
 * ===========================================================================
 *
 * ENV STRATEGY — why we spread envFileVars instead of relying on env_file:
 *
 *   PM2's `env_file` key reads the file once at `pm2 start` time and stores
 *   a snapshot in ~/.pm2/dump.pm2. On a crash-restart, PM2 reloads from that
 *   saved dump — it does NOT re-read env_file. This means:
 *
 *   • If PM2 was started WITHOUT `--env production` (e.g., a bare `pm2 restart`),
 *     the env_production block is never merged and REDIS_URL is absent from the
 *     worker's process.env — causing the old `isRedisAvailable()` guard to throw
 *     at module-load time, which triggers a crash loop of 120+ restarts.
 *
 *   The fix: eagerly parse .env with dotenv.parse() and SPREAD all variables
 *   directly into env_production. Every key is baked into PM2's saved snapshot
 *   at `pm2 start` time, so all crash-restarts inherit the full environment
 *   regardless of how PM2 was invoked.
 *
 * App  (quantum-mon-cheri):
 *   node .next/standalone/server.js
 *   → Runs the Next.js standalone bundle from the last successful build.
 *   → deploy.sh MUST copy public/ and .next/static/ into the standalone dir
 *     before this process is started (otherwise /_next/static/* returns 404).
 *
 * Worker (queue-worker):
 *   node_modules/.bin/tsx lib/queue/queue-worker.ts
 *   → TypeScript-native execution via tsx (no compile step required at runtime).
 *   → exp_backoff_restart_delay: 100 — PM2 doubles the restart delay on each
 *     crash up to max_restarts, preventing a thundering-herd restart loop when
 *     Redis is temporarily unavailable after a server reboot.
 *
 * Launch (recommended — full redeploy):
 *   bash deploy.sh
 *
 * Manual launch after a completed build:
 *   pm2 start ecosystem.config.js --env production
 *
 * App-only (no Redis required):
 *   pm2 start ecosystem.config.js --only quantum-mon-cheri --env production
 * ===========================================================================
 */

const fs   = require('fs');
const path = require('path');

// Eagerly load .env into process.env so that any process.env references
// inside THIS file resolve correctly at parse time.
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Parse the .env file into a plain object so we can SPREAD all variables
// into env_production. This is the crash-safe approach: every variable is
// baked into PM2's saved dump, not looked up lazily at restart time.
let _envFileVars = {};
const _envFilePath = path.join(__dirname, '.env');
if (fs.existsSync(_envFilePath)) {
  try {
    const { parse } = require('dotenv');
    _envFileVars = parse(fs.readFileSync(_envFilePath, 'utf8'));
  } catch (e) {
    // Non-fatal — env_production overrides below still guarantee the
    // minimum required variables are present.
    console.warn('[ecosystem.config.js] Could not parse .env file:', e.message);
  }
}

module.exports = {
  apps: [
    // ── 1. Next.js web server (standalone) ──────────────────────────────────
    {
      name: 'quantum-mon-cheri',

      // Keep cwd at project root so Prisma resolves prisma/schema.prisma and
      // dotenv finds .env relative to the repo, not the standalone bundle dir.
      cwd: __dirname,

      // Pre-built standalone bundle — no next CLI overhead at runtime.
      script: '.next/standalone/server.js',
      interpreter: 'node',

      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 10_000,

      env_production: {
        // Spread ALL .env variables first so nothing is accidentally omitted.
        ..._envFileVars,
        // Hard overrides — these take precedence over anything in the .env file.
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
        REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      },
    },

    // ── 2. BullMQ queue worker ───────────────────────────────────────────────
    {
      name: 'queue-worker',
      cwd: __dirname,

      // Use the locally installed tsx binary for TypeScript-native execution.
      // Equivalent to `npx tsx lib/queue/queue-worker.ts` but avoids the npx
      // overhead on every PM2 restart — critical when restart_delay kicks in.
      script: 'node_modules/.bin/tsx',
      args: 'lib/queue/queue-worker.ts',
      interpreter: 'node',

      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '5s',
      kill_timeout: 10_000,

      // Delay (ms) before PM2 restarts the process after a crash.
      // Combined with exp_backoff_restart_delay: 100, PM2 doubles this value on
      // each successive crash (5s → 10s → 20s → … up to max 16× = 80s).
      // Prevents the worker from hammering Redis during a prolonged outage.
      restart_delay: 5_000,
      exp_backoff_restart_delay: 100,

      env_production: {
        // Spread ALL .env variables first — bakes every secret into PM2's
        // saved dump so crash-restarts always have the full environment.
        ..._envFileVars,
        // Hard overrides — ensure these critical variables are always correct.
        NODE_ENV: 'production',
        QUEUE_ENABLED: 'true',
        QUEUE_CONCURRENCY: '3',
        REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      },
    },
  ],
};
