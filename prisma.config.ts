import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL?.trim() || '';
if (!databaseUrl || !databaseUrl.includes('quantum_admin')) {
  throw new Error('Security Breach: Unauthorized DB User Attempted');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
