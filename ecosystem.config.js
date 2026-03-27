/**
 * PM2 — Next.js standalone output (`output: 'standalone'` in next.config).
 * After `npm run build`, start with: `pm2 start ecosystem.config.js`
 *
 * We merge `.env` here so DATABASE_URL comes from the file on disk every time
 * this config is loaded (avoids stale `postgres` user stuck in `pm2 save` dump).
 * After fixing .env: `pm2 delete quantum-mon-cheri && pm2 start ecosystem.config.js && pm2 save`
 */
const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const text = fs.readFileSync(filePath, 'utf8');
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) env[key] = val;
  }
  return env;
}

const fromEnvFile = parseEnvFile(path.join(__dirname, '.env'));

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
        HOSTNAME: '0.0.0.0',
        PORT: fromEnvFile.PORT || process.env.PORT || '3000',
      },
    },
  ],
};
