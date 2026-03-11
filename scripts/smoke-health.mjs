const baseUrl = process.env.APP_URL || 'http://localhost:3000';

async function check(path) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  if (!res.ok) {
    console.error(`${path} failed with ${res.status}: ${text}`);
    process.exit(1);
  }
  console.log(`${path} ok`);
}

await check('/api/health/live');
await check('/api/health/ready');
console.log('Health smoke passed.');
