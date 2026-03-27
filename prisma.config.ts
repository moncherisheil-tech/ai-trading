import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { getDatasourceUrlForPrismaConfig } from './lib/db/sovereign-db-url';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    get url() {
      return getDatasourceUrlForPrismaConfig();
    },
  },
});
