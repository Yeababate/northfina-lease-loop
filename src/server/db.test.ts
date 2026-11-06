import { afterEach, expect, it, vi } from 'vitest';

const { createPrismaClient } = vi.hoisted(() => ({ createPrismaClient: vi.fn(() => ({})) }));
vi.mock('./prisma-client', () => ({ createPrismaClient }));
const globalDb = globalThis as typeof globalThis & { leaseLoopDb?: unknown };
const original = globalDb.leaseLoopDb;

afterEach(() => {
  if (original === undefined) delete globalDb.leaseLoopDb;
  else globalDb.leaseLoopDb = original;
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

it('reuses the client across development module reloads', async () => {
  delete globalDb.leaseLoopDb;
  vi.stubEnv('NODE_ENV', 'development');
  const first = (await import('./db')).db;
  vi.resetModules();
  expect((await import('./db')).db).toBe(first);
  expect(createPrismaClient).toHaveBeenCalledTimes(1);
});

it('does not retain a production client on the development global', async () => {
  delete globalDb.leaseLoopDb;
  vi.stubEnv('NODE_ENV', 'production');
  await import('./db');
  expect(createPrismaClient).toHaveBeenCalledTimes(1);
  expect(globalDb.leaseLoopDb).toBeUndefined();
});
