type UpstashResponse = {
  result?: number;
};

export async function allowDistributedRequest(key: string, limit: number, windowMs: number): Promise<boolean | null> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !restToken) {
    return null;
  }

  const now = Date.now();
  const bucketKey = `rl:${key}:${Math.floor(now / windowMs)}`;

  try {
    const incrRes = await fetch(`${restUrl}/incr/${encodeURIComponent(bucketKey)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restToken}`,
      },
      cache: 'no-store',
    });

    if (!incrRes.ok) {
      return null;
    }

    const incrData = (await incrRes.json()) as UpstashResponse;
    const value = Number(incrData.result || 0);

    if (value === 1) {
      fetch(`${restUrl}/expire/${encodeURIComponent(bucketKey)}/${Math.ceil(windowMs / 1000)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${restToken}`,
        },
        cache: 'no-store',
      }).catch(() => {});
    }

    return value <= limit;
  } catch {
    return null;
  }
}
