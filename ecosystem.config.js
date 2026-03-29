/**
 * PM2 — Next.js standalone (`output: 'standalone'` in next.config).
 * Secrets load only from `.env` via PM2's native `env_file` (PM2 ≥5.3).
 * Non-sensitive routing/runtime flags stay in `env` below — no dotenv in this file.
 *
 * Apps:
 *   1. quantum-mon-cheri  — Next.js web server
 *   2. queue-worker       — BullMQ worker (requires QUEUE_ENABLED=true + REDIS_URL in .env)
 *
 * To run with queue:
 *   pm2 start ecosystem.config.js
 *
 * To run legacy-only (no Redis):
 *   pm2 start ecosystem.config.js --only quantum-mon-cheri
 */
module.exports = {
  apps: [
    {
      name: 'quantum-mon-cheri',
      cwd: __dirname,
      script: '.next/standalone/server.js',
      interpreter: 'node',
      env_file: '.env',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
      },
    },
    {
      name: 'queue-worker',
      cwd: __dirname,
      /**
       * Uses ts-node with tsconfig-paths for TypeScript execution.
       * In production, compile first: `npx tsc --project tsconfig.worker.json`
       * and point script to `dist/lib/queue/queue-worker.js` instead.
       */
      script: 'lib/queue/queue-worker.ts',
      interpreter: 'node',
      interpreter_args: '--require ts-node/register --require tsconfig-paths/register',
      env_file: '.env',
      instances: 1,
      autorestart: true,
      max_restarts: 30,
      min_uptime: '5s',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        QUEUE_ENABLED: 'true',
        QUEUE_CONCURRENCY: '3',
      },
    },
  ],
};
