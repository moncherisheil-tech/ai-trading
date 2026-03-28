/**
 * PM2 — Next.js standalone (`output: 'standalone'` in next.config).
 * Secrets load only from `.env` via PM2’s native `env_file` (PM2 ≥5.3).
 * Non-sensitive routing/runtime flags stay in `env` below — no dotenv in this file.
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
  ],
};
