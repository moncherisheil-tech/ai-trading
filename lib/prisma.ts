import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * Prisma ORM 7 requires a driver adapter. Uses `@prisma/adapter-pg` with `DATABASE_URL`.
 * Returns null when the URL is unset so modules that never call DB stay build-safe.
 */
export function getPrisma(): PrismaClient | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg(url);
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}
