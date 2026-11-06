// Remembered answers and readiness through the real routes (#51), on a migrated database.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../tests/helpers/test-db';
import { DELETE as forgetAllRoute, GET as listRoute } from '@/app/api/profile/answers/route';
import {
  DELETE as forgetRoute,
  PUT as saveRoute,
} from '@/app/api/profile/answers/[questionId]/route';
import { GET as readinessRoute } from '@/app/api/assets/[id]/readiness/route';
import { GET as batchRoute } from '@/app/api/assets/readiness/route';
import { seedAssets } from './assets';
import { demoNameCookieHeader } from './demo-cookie';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
// The last day of price list 1, as in the other route tests.
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));

let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.savedAnswer.deleteMany();
  await db.auditLog.deleteMany();
});

const headers = (name: string | null): Record<string, string> =>
  name === null ? {} : { cookie: demoNameCookieHeader(name) };

async function call(response: Promise<Response>) {
  const res = await response;
  return { status: res.status, body: await res.json() };
}

const save = (name: string, questionId: string, profile: string, value: unknown) =>
  call(
    saveRoute(
      new Request(`http://test/api/profile/answers/${questionId}`, {
        method: 'PUT',
        headers: { ...headers(name), 'content-type': 'application/json' },
        body: JSON.stringify({ profile, value }),
      }),
      { params: Promise.resolve({ questionId }) }
    )
  );

const list = (name: string) =>
  call(
    listRoute(new Request('http://test/api/profile/answers', { headers: headers(name) }), undefined)
  );

const readiness = (name: string | null, id: string, search = '') =>
  call(
    readinessRoute(
      new Request(`http://test/api/assets/${id}/readiness?${search}`, { headers: headers(name) }),
      { params: Promise.resolve({ id }) }
    )
  );

const AINO: Record<string, unknown> = {
  q_full_name: 'Aino Virtanen',
  q_birth_date: '1997-04-12',
  q_email: 'aino.virtanen@example.com',
  q_country: 'FI',
  q_employment: 'employed',
  q_monthly_income: 320000,
  q_pep: 'no',
};

async function saveAll(name: string, profile: string, answers: Record<string, unknown>) {
  for (const [id, value] of Object.entries(answers)) {
    const { status } = await save(name, id, profile, value);
    expect(status, id).toBe(200);
  }
}

describe('remembered answers', () => {
  it('Aino saves her profile; ebike-003 is then ready', async () => {
    expect((await readiness('Aino', 'ebike-003')).body.data.status).toBe('missing');
    await saveAll('Aino', 'consumer', AINO);
    const { status, body } = await readiness('Aino', 'ebike-003');
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      profileKey: 'consumer',
      assetId: 'ebike-003',
      status: 'ready',
      dealQuestionIds: ['q_usage_purpose'],
    });
  });

  it('Mikko is declined on the age rule, and his profile carries the flag', async () => {
    await saveAll('Mikko', 'consumer', { ...AINO, q_birth_date: '2009-03-10' });
    const { body } = await readiness('Mikko', 'laptop-008', 'term=24');
    expect(body.data).toMatchObject({ status: 'declined', reasons: ['min_age'] });
    const profiles = (await list('Mikko')).body.data.profiles;
    expect(profiles[0].flags).toContainEqual(
      expect.objectContaining({ id: 'under_18', until: '2027-03-10' })
    );
  });

  it('a PEP gets manual review from €10,000 and ready below it', async () => {
    await saveAll('Pia', 'consumer', { ...AINO, q_pep: 'yes', q_pep_details: 'City council' });
    const batch = await call(
      batchRoute(
        new Request('http://test/api/assets/readiness?ids=ebike-003,farm-003,nope', {
          headers: headers('Pia'),
        }),
        undefined
      )
    );
    expect(batch.status).toBe(200);
    const statuses = batch.body.data.items.map((i: { status: string }) => i.status);
    expect(statuses[0]).toBe('ready');
    expect(statuses[1]).toBe('manual_review');
    expect(statuses[2]).toBe('not_found');
  });

  it('signed out: every applicable question is missing', async () => {
    const { body } = await readiness(null, 'ebike-003');
    expect(body.data).toMatchObject({
      profileKey: null,
      status: 'missing',
      missing: { questionIds: ['q_customer_type', 'q_email'] },
    });
  });

  it('changing q_can_sign drops the signatory email, and the audit never holds a value', async () => {
    const norvi = 'company:3299871-7';
    await saveAll('Norvi', norvi, { q_can_sign: 'no', q_signatory_email: 'ceo@norvi.example.com' });
    const changed = await save('Norvi', 'q_can_sign', norvi, 'yes');
    expect(changed.body.data.removed).toEqual(['q_signatory_email']);
    const profile = (await list('Norvi')).body.data.profiles[0];
    expect(profile.answers).toEqual({ q_can_sign: 'yes' });

    const audit = await db.auditLog.findMany();
    expect(audit.map((row) => row.action)).toEqual([
      'demo_user.created',
      'saved_answer.saved',
      'saved_answer.saved',
      'saved_answer.saved',
    ]);
    const details = audit.map((row) => row.details_json ?? '').join(' ');
    expect(details).not.toContain('ceo@norvi');
    expect(details).not.toContain('"yes"');
  });

  it('keeps separate sets per customer type', async () => {
    await save('Dual', 'q_email', 'consumer', 'me@example.com');
    await save('Dual', 'q_email', 'company:3299871-7', 'fleet@example.com');
    const profiles = (await list('Dual')).body.data.profiles;
    expect(profiles.map((p: { profileKey: string }) => p.profileKey).sort()).toEqual([
      'company:3299871-7',
      'consumer',
    ]);
    const asCompany = await readiness('Dual', 'ebike-003', 'profile=company:3299871-7');
    expect(asCompany.body.data.profileKey).toBe('company:3299871-7');
  });

  it('forgets one answer with its dependants, then everything', async () => {
    await saveAll('Aino', 'consumer', { q_pep: 'yes', q_pep_details: 'Mayor', q_email: 'a@b.fi' });
    const forgot = await call(
      forgetRoute(
        new Request('http://test/api/profile/answers/q_pep?profile=consumer', {
          method: 'DELETE',
          headers: headers('Aino'),
        }),
        { params: Promise.resolve({ questionId: 'q_pep' }) }
      )
    );
    expect(forgot.body.data.removed).toEqual(['q_pep', 'q_pep_details']);
    const all = await call(
      forgetAllRoute(
        new Request('http://test/api/profile/answers', {
          method: 'DELETE',
          headers: headers('Aino'),
        }),
        undefined
      )
    );
    expect(all.body.data.count).toBe(1);
    expect((await list('Aino')).body.data.profiles).toEqual([]);
  });

  it('rejects what cannot be remembered', async () => {
    expect((await save('Aino', 'q_usage_purpose', 'consumer', 'commuting')).body.error.code).toBe(
      'NOT_REMEMBERABLE'
    );
    expect((await save('Aino', 'q_customer_type', 'consumer', 'consumer')).body.error.code).toBe(
      'IMPLIED_BY_PROFILE'
    );
    expect((await save('Aino', 'q_email', 'consumer', 'nope')).body.error).toMatchObject({
      code: 'INVALID_ANSWER',
      details: 'bad_email',
    });
    expect((await save('Aino', 'q_email', 'company:1234567-8', 'a@b.fi')).body.error.code).toBe(
      'INVALID_PROFILE'
    );
    expect((await list('')).status).toBe(401);
    expect(await db.savedAnswer.count()).toBe(0);
  });

  it('reports a reserved item as not leasable and an unknown one as 404', async () => {
    expect((await readiness('Aino', 'ebike-009')).body.data.status).toBe('not_leasable');
    expect((await readiness('Aino', 'nope')).status).toBe(404);
    expect((await readiness('Aino', 'ebike-003', 'term=30')).status).toBe(400);
  });
});
