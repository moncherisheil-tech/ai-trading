import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { assertAuthorizedDatabaseUrl } from './lib/db/sovereign-db-url';

const databaseUrl = process.env.DATABASE_URL?.trim() || '';
assertAuthorizedDatabaseUrl(databaseUrl);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
