import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/** Placeholder for Prisma CLI (generate/migrate) when DATABASE_URL is unset — no validation, no DB connect. */
const PRISMA_SCHEMA_TOOLING_URL =
  'postgresql://quantum_admin:sovereign_build@127.0.0.1:5432/_prisma_schema_tooling?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    get url() {
      const url = process.env.DATABASE_URL?.trim() || '';
      return url || PRISMA_SCHEMA_TOOLING_URL;
    },
  },
});
