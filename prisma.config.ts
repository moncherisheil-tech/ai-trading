import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/** Synthetic URL for Prisma CLI when DATABASE_URL is unset — never connects unless you run migrate against it. */
const PRISMA_SCHEMA_TOOLING_URL =
  'postgresql://postgres:postgres@127.0.0.1:5432/_prisma_schema_tooling?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    get url() {
      const url = process.env.DATABASE_URL?.trim() || '';
      return url || PRISMA_SCHEMA_TOOLING_URL;
    },
  },
});
