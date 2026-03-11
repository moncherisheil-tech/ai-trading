import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required for migrate-postgres.');
  process.exit(1);
}

const migrationsDir = path.join(process.cwd(), 'migrations', 'postgres');
const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const client = new Client({ connectionString });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    file_name TEXT UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

for (const file of files) {
  const existing = await client.query('SELECT 1 FROM schema_migrations WHERE file_name = $1 LIMIT 1', [file]);
  if (existing.rowCount) {
    continue;
  }

  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (file_name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`Applied migration ${file}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

await client.end();
console.log('Migrations complete.');
