/**
 * Pre-deployment connection dry-run.
 * Tests ONLY Redis and Postgres handshakes — no app code is loaded.
 *
 * Run on the server:
 *   npx ts-node --project tsconfig.json -e "$(cat test-connections.ts)"
 * or (if ts-node is global):
 *   ts-node test-connections.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import IORedis from 'ioredis';
import { Client as PgClient } from 'pg';

const PLACEHOLDER_PATTERNS = ['YOUR_PASSWORD', 'YOUR_HOST', 'YOUR_PORT', '<token>', '<host>', '<port>'];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => value.includes(p));
}

function pass(msg: string) {
  console.log(`  ✅  ${msg}`);
}

function fail(msg: string) {
  console.error(`  ❌  ${msg}`);
}

function warn(msg: string) {
  console.warn(`  ⚠️   ${msg}`);
}

// ─── Redis ───────────────────────────────────────────────────────────────────
async function testRedis(): Promise<boolean> {
  console.log('\n[1/2] Redis Handshake');

  const url = process.env.REDIS_URL ?? '';

  if (!url) {
    fail('REDIS_URL is not set in .env');
    return false;
  }

  if (isPlaceholder(url)) {
    fail(`REDIS_URL is still a placeholder value: "${url}"`);
    fail('Replace with your real Upstash/Redis connection string before deploying.');
    return false;
  }

  if (!url.startsWith('rediss://') && !url.startsWith('redis://')) {
    fail(`REDIS_URL must start with redis:// or rediss://. Got: "${url.slice(0, 30)}..."`);
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 8_000,
      tls: url.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      lazyConnect: true,
    });

    const timer = setTimeout(() => {
      client.disconnect();
      fail('Redis connection timed out after 8 s');
      resolve(false);
    }, 9_000);

    client.on('error', (err) => {
      clearTimeout(timer);
      client.disconnect();
      fail(`Redis connection error: ${err.message}`);
      resolve(false);
    });

    client
      .connect()
      .then(() => client.ping())
      .then((pong) => {
        clearTimeout(timer);
        client.disconnect();
        if (pong === 'PONG') {
          pass('Redis Handshake Successful  →  PONG received');
          resolve(true);
        } else {
          fail(`Expected PONG, got: ${pong}`);
          resolve(false);
        }
      })
      .catch((err) => {
        clearTimeout(timer);
        client.disconnect();
        fail(`Redis error: ${err.message}`);
        resolve(false);
      });
  });
}

// ─── Postgres ─────────────────────────────────────────────────────────────────
async function testPostgres(): Promise<boolean> {
  console.log('\n[2/2] PostgreSQL Handshake');

  const url = process.env.DATABASE_URL ?? '';

  if (!url) {
    fail('DATABASE_URL is not set in .env');
    return false;
  }

  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    fail(`DATABASE_URL must start with postgresql:// or postgres://. Got: "${url.slice(0, 30)}..."`);
    return false;
  }

  const client = new PgClient({
    connectionString: url,
    connectionTimeoutMillis: 8_000,
    ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const result = await client.query<{ now: Date }>('SELECT NOW() AS now');
    await client.end();
    pass(`PostgreSQL Handshake Successful  →  Server time: ${result.rows[0].now}`);
    return true;
  } catch (err: unknown) {
    await client.end().catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    fail(`PostgreSQL connection error: ${msg}`);
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════════');
  console.log('  QUANTUM MON CHERI — Pre-Deployment Connection Audit');
  console.log('════════════════════════════════════════════════════');

  const redisOk = await testRedis();
  const pgOk = await testPostgres();

  console.log('\n──────────────────────────────────────────────────');

  if (redisOk && pgOk) {
    console.log('\n🟢  All systems nominal.');
    console.log('    System Secure — Ready for Launch\n');
    process.exit(0);
  } else {
    console.error('\n🔴  One or more connections FAILED.');
    console.error('    DO NOT proceed with deployment until all issues are resolved.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
