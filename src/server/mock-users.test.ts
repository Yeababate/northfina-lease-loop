import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../../tests/helpers/test-db';
import type { PrismaClient } from './prisma-client';
import { demoNameCookieHeader } from './demo-cookie';
import { ensureDemoUser, principalFromRequest, requirePrincipal } from './mock-users';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});

describe('demo participants', () => {
  it('has one creator and a truthful audit under concurrent username selection', async () => {
    const users = await Promise.all([
      ensureDemoUser(db, 'Concurrent'),
      ensureDemoUser(db, 'CONCURRENT'),
    ]);
    expect(users[0]!.id).toBe(users[1]!.id);
    expect(await db.auditLog.count({ where: { entity_id: users[0]!.id } })).toBe(1);
  });
  it('creates one stable, audited profile across case and whitespace changes', async () => {
    const first = await ensureDemoUser(db, ' Aino ');
    expect(await ensureDemoUser(db, 'AINO')).toEqual(first);
    expect(first.moderator).toBe(false);
    expect(
      await db.auditLog.count({ where: { entity_id: first.id, action: 'demo_user.created' } })
    ).toBe(1);
    const request = new Request('http://localhost', {
      headers: { cookie: demoNameCookieHeader('  aino ') },
    });
    expect(await principalFromRequest(db, request)).toEqual(first);
    expect(await requirePrincipal(db, request)).toEqual(first);
  });
  it('creates the participant for a first-time sign-in name, once and audited', async () => {
    const request = new Request('http://localhost', {
      headers: { cookie: `theme=dark; ${demoNameCookieHeader('Maija Haapala')}` },
    });
    const created = await requirePrincipal(db, request);
    expect(created).toMatchObject({
      canonicalUsername: 'maija haapala',
      displayName: 'Maija Haapala',
    });
    expect(await requirePrincipal(db, request)).toEqual(created);
    expect(await db.auditLog.count({ where: { entity_id: created.id } })).toBe(1);
  });
  it('does not accept missing, malformed, invalid or foreign identity cookies', async () => {
    const before = await db.demoUser.count();
    for (const cookie of [
      '',
      'lease-loop-name=%',
      'lease-loop-name=%20%20',
      `lease-loop-name=${'a'.repeat(61)}`,
      // The old #5 cookie carried a DemoUser ID; it no longer selects anyone.
      'lease-loop-user=cust-aino',
    ]) {
      const request = new Request('http://localhost', { headers: { cookie } });
      expect(await principalFromRequest(db, request)).toBeNull();
      await expect(requirePrincipal(db, request)).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    }
    expect(await db.demoUser.count()).toBe(before);
    await expect(ensureDemoUser(db, ' ')).rejects.toMatchObject({ code: 'INVALID_USERNAME' });
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
    await expect(ensureDemoUser(failing as unknown as PrismaClient, 'Rollback')).rejects.toThrow(
      'audit unavailable'
    );
    expect(await db.demoUser.findUnique({ where: { canonicalUsername: 'rollback' } })).toBeNull();
  });
});
