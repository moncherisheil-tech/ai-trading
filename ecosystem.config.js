/**
 * PM2 — Next.js standalone output (`output: 'standalone'` in next.config).
 * After `npm run build`, start with: `pm2 start ecosystem.config.js`
 */
module.exports = {
  apps: [
    {
      name: 'quantum-mon-cheri',
      cwd: __dirname,
      script: '.next/standalone/server.js',
      interpreter: 'node',
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
