import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import {
  assertAuthorizedDatabaseUrl,
  isDbConfigBuildPhaseImmune,
} from './lib/db/sovereign-db-url';

const databaseUrl = process.env.DATABASE_URL?.trim() || '';
if (!isDbConfigBuildPhaseImmune()) {
  assertAuthorizedDatabaseUrl(databaseUrl);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
