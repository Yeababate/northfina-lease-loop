import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { seedAssets } from './assets';
import { seedDemoParticipants } from './demo-participants';
import type { PrismaClient } from './prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

it('does not steal a taken username or invent ownership for an imported item', async () => {
  const assets = await loadAssets();
  await seedAssets(db, [
    ...assets,
    { ...assets[0]!, id: 'custom-bike', serial_number: 'CUSTOM-001' },
  ]);
  await db.demoUser.create({
    data: { id: 'unrelated-user', canonicalUsername: 'kettu', displayName: 'Already here' },
  });
  await seedDemoParticipants(db);
  expect(await db.demoUser.findUnique({ where: { id: 'provider-kettu' } })).toBeNull();
  expect(await db.demoUser.findUnique({ where: { id: 'unrelated-user' } })).toMatchObject({
    displayName: 'Already here',
  });
  for (const id of ['custom-bike', 'ebike-003']) {
    expect(await db.asset.findUnique({ where: { id } })).toMatchObject({ ownerId: null });
  }
});
