import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../../tests/helpers/test-db';
import type { PrismaClient } from './prisma-client';
import { principalFromRequest, requirePrincipal, selectMockUser } from './mock-users';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

describe('mock users', () => {
  it('has one creator and a truthful audit under concurrent username selection', async () => {
    const users = await Promise.all([
      selectMockUser(db, 'Concurrent'),
      selectMockUser(db, 'CONCURRENT'),
    ]);
    expect(users[0]!.id).toBe(users[1]!.id);
    expect(await db.auditLog.count({ where: { entity_id: users[0]!.id } })).toBe(1);
  });
  it('creates one stable, audited profile across case and whitespace changes', async () => {
    const first = await selectMockUser(db, ' Aino ');
    expect(await selectMockUser(db, 'AINO')).toEqual(first);
    expect(first.moderator).toBe(false);
    expect(
      await db.auditLog.count({ where: { entity_id: first.id, action: 'demo_user.created' } })
    ).toBe(1);
    const request = new Request('http://localhost', {
      headers: { cookie: `lease-loop-user=${first.id}` },
    });
    expect(await principalFromRequest(db, request)).toEqual(first);
    expect(await requirePrincipal(db, request)).toEqual(first);
  });
  it('does not accept missing, malformed or unknown identity cookies', async () => {
    for (const cookie of ['', 'lease-loop-user=%', 'lease-loop-user=unknown']) {
      const request = new Request('http://localhost', { headers: { cookie } });
      expect(await principalFromRequest(db, request)).toBeNull();
      await expect(requirePrincipal(db, request)).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    }
    await expect(selectMockUser(db, ' ')).rejects.toMatchObject({ code: 'INVALID_USERNAME' });
  });
  it('cannot leave a profile without its audit row', async () => {
    const failing = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit unavailable');
          },
        },
      },
    });
    await expect(selectMockUser(failing as unknown as PrismaClient, 'Rollback')).rejects.toThrow(
      'audit unavailable'
    );
    expect(await db.demoUser.findUnique({ where: { canonicalUsername: 'rollback' } })).toBeNull();
  });
});
