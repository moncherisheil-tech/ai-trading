'use server';

/**
 * Diagnostics Server Actions
 *
 * Provides system health checks for the Control Room dashboard.
 * No authentication required — public health endpoint.
 *
 * Infrastructure topology:
 *   WS1 (DB)    → 178.104.75.47:5432  (PostgreSQL, bare-metal, Berlin)
 *   WS2 (Redis) → 88.99.208.99:6379   (Redis, bare-metal, Nuremberg)
 */

import { prisma } from '@/lib/prisma';
import Redis from 'ioredis';

interface ServiceHealth {
  status: 'ONLINE' | 'OFFLINE';
  latency: number | null;
  host: string;
  error?: string;
}

export interface SystemHealth {
  db: ServiceHealth;
  redis: ServiceHealth;
  timestamp: string;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const timestamp = new Date().toISOString();

  const [db, redis] = await Promise.all([checkDatabase(), checkRedis()]);

  return { db, redis, timestamp };
}

async function checkDatabase(): Promise<ServiceHealth> {
  const host = '178.104.75.47:5432';
  const start = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ONLINE', latency: Date.now() - start, host };
  } catch (err) {
    return {
      status: 'OFFLINE',
      latency: null,
      host,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const host = '88.99.208.99:6379';
  const redisUrl = process.env.WHALE_REDIS_URL;

  if (!redisUrl) {
    return { status: 'OFFLINE', latency: null, host, error: 'WHALE_REDIS_URL not set' };
  }

  const client = new Redis(redisUrl, {
    connectTimeout: 5_000,
    commandTimeout: 5_000,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
  });

  const start = Date.now();

  try {
    await client.connect();
    const pong = await client.ping();
    const latency = Date.now() - start;

    if (pong !== 'PONG') {
      return { status: 'OFFLINE', latency, host, error: `Unexpected ping response: ${pong}` };
    }

    return { status: 'ONLINE', latency, host };
  } catch (err) {
    return {
      status: 'OFFLINE',
      latency: null,
      host,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    client.disconnect();
  }
}
