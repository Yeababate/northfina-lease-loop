import { afterEach, expect, it, vi } from 'vitest';
import { createPrismaClient } from './prisma-client';

afterEach(() => vi.unstubAllEnvs());

it('reports missing configuration before opening a connection', () => {
  vi.stubEnv('DATABASE_URL', undefined);
  expect(() => createPrismaClient()).toThrow('DATABASE_URL is not set');
  expect(() => createPrismaClient('')).toThrow('Run `npm run db:setup`');
});

it('uses the environment URL when no explicit URL is supplied', async () => {
  vi.stubEnv('DATABASE_URL', 'file::memory:');
  const db = createPrismaClient();
  try {
    expect(await db.$queryRaw`SELECT 1 AS value`).toEqual([{ value: 1n }]);
  } finally {
    await db.$disconnect();
  }
});
