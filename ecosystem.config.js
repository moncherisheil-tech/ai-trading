/**
 * PM2 Ecosystem — Production
 * ===========================================================================
 *
 * dotenv is loaded here at module parse time so that any process.env reference
 * inside THIS file (e.g. dynamic port reads) picks up .env values immediately.
 * PM2's own env_file key is also set so that PM2's internal env snapshot
 * captures the same variables for restarts / cluster forks.
 *
 * App  (quantum-mon-cheri):
 *   node .next/standalone/server.js
 *   → Runs the Next.js standalone bundle from the last successful build.
 *   → deploy.sh MUST copy public/ and .next/static/ into the standalone dir
 *     before this process is started (otherwise /_next/static/* returns 404).
 *
 * Worker (queue-worker):
 *   npx tsx lib/queue/queue-worker.ts
 *   → TypeScript-native execution via tsx (no compile step required at runtime).
 *   → queue-worker.ts calls `import 'dotenv/config'` itself, but the env_file
 *     key below ensures PM2's restart/fork copies also receive the env snapshot.
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

// Eagerly load .env so any process.env references in this file resolve correctly.
// Path is explicit (__dirname) so this works regardless of cwd at pm2 invocation time.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

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

      // PM2 reads env_file and merges it with env_production at (re)start.
      env_file: '.env',
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
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

      // PM2 reads env_file and merges it with env_production at (re)start.
      env_file: '.env',
      env_production: {
        NODE_ENV: 'production',
        QUEUE_ENABLED: 'true',
        QUEUE_CONCURRENCY: '3',
        REDIS_URL: 'redis://127.0.0.1:6379',
      },
    },
  ],
};
