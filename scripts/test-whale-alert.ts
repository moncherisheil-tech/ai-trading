/**
 * Test utility — publishes a mock whale alert to a Redis channel.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/test-whale-alert.ts
 *
 * By default publishes to WHALE_REDIS_URL (or redis://127.0.0.1:6379 fallback).
 * Temporarily point WHALE_REDIS_URL to a local Redis to test without the
 * remote Rust engine running.
 */
import IORedis from 'ioredis';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TARGET_URL = process.env.WHALE_REDIS_URL || 'redis://127.0.0.1:6379';
const CHANNEL    = 'quant:alerts';

const mockAlert = {
  symbol:       'BTCUSDT',
  anomaly_type: 'LIQUIDITY_SPIKE',
  delta_pct:    18.47,
  timestamp:    new Date().toISOString(),
};

async function main() {
  const client = new IORedis(TARGET_URL, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5_000,
  });

  client.on('error', (err) => {
    console.error('[TestPublisher] Redis error:', err.message);
    process.exit(1);
  });

  const payload = JSON.stringify(mockAlert);
  console.log(`[TestPublisher] Publishing to ${TARGET_URL} → channel "${CHANNEL}"`);
  console.log(`[TestPublisher] Payload: ${payload}`);

  const receivers = await client.publish(CHANNEL, payload);
  console.log(`[TestPublisher] Delivered to ${receivers} subscriber(s).`);

  await client.quit();
  process.exit(0);
}

main().catch((err) => {
  console.error('[TestPublisher] Fatal:', err);
  process.exit(1);
});
