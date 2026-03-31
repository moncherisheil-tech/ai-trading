/**
 * PM2 Ecosystem — Production
 *
 * Main app  : `node .next/standalone/server.js`
 *             → Runs the self-contained standalone bundle produced by
 *               `output: 'standalone'` in next.config.ts.
 *             → deploy.sh MUST copy public/ and .next/static/ into the
 *               standalone directory before this process is started.
 *             → PORT and HOSTNAME are set via env_production below.
 * Worker    : `tsx lib/queue/queue-worker.ts`
 *             → tsx handles TypeScript + @/ path-alias resolution natively.
 *             → queue-worker.ts loads `dotenv/config` itself, so .env is read
 *               before any Redis/BullMQ client is instantiated.
 *
 * Launch (full deploy — preferred):
 *   bash deploy.sh
 *
 * Manual launch after a completed build:
 *   pm2 start ecosystem.config.js --env production
 *
 * App-only (no Redis required):
 *   pm2 start ecosystem.config.js --only quantum-mon-cheri --env production
 */
module.exports = {
  apps: [
    // ── 1. Next.js web server (standalone) ────────────────────────────────
    {
      name: 'quantum-mon-cheri',
      // Keep cwd at project root so Prisma can find prisma/schema.prisma and
      // dotenv resolves .env relative to the repo, not the standalone bundle.
      cwd: __dirname,
      // Run the pre-built standalone server directly — no next CLI overhead.
      // Static assets are served from .next/standalone/.next/static/ (copied
      // by deploy.sh). Public assets from .next/standalone/public/ (also copied).
      script: '.next/standalone/server.js',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      env_file: '.env',
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
      },
    },

    // ── 2. BullMQ queue worker ─────────────────────────────────────────────
    {
      name: 'queue-worker',
      cwd: __dirname,
      script: 'node_modules/.bin/tsx',
      args: 'lib/queue/queue-worker.ts',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '5s',
      kill_timeout: 10000,
      env_file: '.env',
      env_production: {
        NODE_ENV: 'production',
        QUEUE_ENABLED: 'true',
        QUEUE_CONCURRENCY: '3',
      },
    },
  ],
};
