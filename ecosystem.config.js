/**
 * PM2 Ecosystem — Production
 *
 * Main app  : `next start` via node_modules/next/dist/bin/next
 *             → No manual static-file copying; Next.js owns all asset serving.
 * Worker    : `tsx lib/queue/queue-worker.ts`
 *             → tsx handles TypeScript + @/ path-alias resolution natively.
 *             → queue-worker.ts loads `dotenv/config` itself, so .env is read
 *               before any Redis/BullMQ client is instantiated.
 *
 * Launch:
 *   pm2 start ecosystem.config.js --env production
 *
 * App-only (no Redis required):
 *   pm2 start ecosystem.config.js --only quantum-mon-cheri --env production
 */
module.exports = {
  apps: [
    // ── 1. Next.js web server ──────────────────────────────────────────────
    {
      name: 'quantum-mon-cheri',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      // --hostname 0.0.0.0 ensures the server listens on all interfaces, not just
      // loopback. Without this, external traffic cannot reach the process.
      args: 'start --hostname 0.0.0.0 --port 3000',
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
