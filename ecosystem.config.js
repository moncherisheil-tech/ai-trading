/**
 * PM2 — Next.js standalone (`output: 'standalone'` in next.config).
 * dotenv runs at config load time so every `pm2 start|reload … --update-env`
 * merges `.env` from disk into the app `env` block (no reliance on shell export).
 */
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');
const dotenvResult = dotenv.config({ path: envPath });
const fromEnvFile = dotenvResult.parsed && typeof dotenvResult.parsed === 'object'
  ? { ...dotenvResult.parsed }
  : {};

if (dotenvResult.error && dotenvResult.error.code !== 'ENOENT') {
  console.warn('[ecosystem.config] dotenv:', dotenvResult.error.message);
}

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
        ...fromEnvFile,
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
      },
    },
  ],
};
