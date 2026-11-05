import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as ownGET, POST } from '@/app/api/contracts/[id]/ratings/route';
import { PATCH } from '@/app/api/ratings/[id]/route';
import { GET as publicGET } from '@/app/api/users/[id]/ratings/route';
import { createTestDb } from '../../tests/helpers/test-db';
import type { PrismaClient } from './prisma-client';
import { createRating, editRating, ownContractRating, publicRatings } from './ratings';

let db: PrismaClient;
let cleanup: () => Promise<void>;
vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.ratingRevision.deleteMany();
  await db.rating.deleteMany();
  await db.contractLifecycle.deleteMany();
  await db.contractLine.deleteMany();
  await db.contract.deleteMany();
  await db.demoUser.deleteMany();
  await db.auditLog.deleteMany();
  await db.demoUser.createMany({
    data: ['renter', 'provider', 'other'].map((id) => ({
      id,
      canonicalUsername: id,
      displayName: id,
    })),
  });
  for (const [id, status] of [
    ['done', 'completed_return'],
    ['bought', 'completed_buyout'],
    ['active', 'active'],
  ]) {
    await db.contract.create({
      data: {
        id: id!,
        actor: 'Applicant',
        assetId: 'asset',
        startOn: '2026-01-01',
        endOn: '2026-02-01',
        signedOn: '2026-01-01',
        termMonths: 12,
        downPaymentCents: 0,
        listPriceCents: 100000,
        priceListVersion: 1,
        coefficientVersion: 1,
        coefficientId: 'table',
        band: 'A',
        factor: 0.01,
        financedCents: 100000,
        monthlyNetCents: 1000,
        buyoutNetCents: 20000,
        renterId: 'renter',
        providerId: 'provider',
        lifecycle: { create: { status: status! } },
      },
    });
  }
});

describe('audited participant reviews', () => {
  it('creates both directions with immutable evidence and rejects duplicates', async () => {
    const rating = await createRating(db, 'done', 'renter', { stars: 5, comment: ' thanks ' });
    expect(rating).toMatchObject({
      subjectId: 'provider',
      direction: 'renter_to_provider',
      stars: 5,
      comment: 'thanks',
      currentRevision: 1,
      visibility: 'visible',
    });
    await createRating(db, 'done', 'provider', { stars: 4 });
    await expect(createRating(db, 'done', 'renter', { stars: 2 })).rejects.toMatchObject({
      code: 'RATING_EXISTS',
      status: 409,
    });
    expect(await db.rating.count()).toBe(2);
    expect(await db.ratingRevision.count()).toBe(2);
    expect(await db.auditLog.count()).toBe(2);
    expect(await db.ratingRevision.findFirst({ where: { ratingId: rating.id } })).toMatchObject({
      revision: 1,
      stars: 5,
      comment: 'thanks',
      authorId: 'renter',
    });
  });
  it('accepts completed buyouts, never a past end date without operational completion', async () => {
    await createRating(db, 'bought', 'renter', { stars: 4 });
    await expect(createRating(db, 'active', 'renter', { stars: 5 })).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
      details: 'not_completed',
    });
    await expect(createRating(db, 'done', 'other', { stars: 5 })).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
    });
    await expect(createRating(db, 'missing', 'renter', { stars: 5 })).rejects.toMatchObject({
      code: 'CONTRACT_NOT_FOUND',
    });
    await expect(createRating(db, 'done', 'renter', { stars: 6 })).rejects.toMatchObject({
      code: 'INVALID_RATING',
    });
    expect(await db.rating.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });
  it('requires stable participants rather than matching the applicant name', async () => {
    await db.contract.update({ where: { id: 'done' }, data: { renterId: null } });
    await expect(createRating(db, 'done', 'provider', { stars: 5 })).rejects.toMatchObject({
      details: 'participants_missing',
    });
  });
  it('edits one review, preserves old evidence and moderation state, and rejects stale/foreign edits', async () => {
    const rating = await createRating(db, 'done', 'renter', { stars: 1, comment: 'original' });
    await db.rating.update({ where: { id: rating.id }, data: { visibility: 'hidden' } });
    const updated = await editRating(db, rating.id, 'renter', {
      expectedRevision: 1,
      stars: 4,
      comment: 'revised',
    });
    expect(updated).toMatchObject({ stars: 4, currentRevision: 2, visibility: 'hidden' });
    expect(await db.rating.count()).toBe(1);
    const revisions = await db.ratingRevision.findMany({
      where: { ratingId: rating.id },
      orderBy: { revision: 'asc' },
    });
    expect(revisions.map((r) => [r.revision, r.stars, r.comment])).toEqual([
      [1, 1, 'original'],
      [2, 4, 'revised'],
    ]);
    await expect(
      editRating(db, rating.id, 'renter', { expectedRevision: 1, stars: 5 })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      editRating(db, rating.id, 'provider', { expectedRevision: 2, stars: 5 })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      editRating(db, rating.id, 'renter', { expectedRevision: 2, stars: 9 })
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      editRating(db, 'missing', 'renter', { expectedRevision: 1, stars: 5 })
    ).rejects.toMatchObject({ code: 'RATING_NOT_FOUND' });
    expect(await db.ratingRevision.count()).toBe(2);
    expect(await db.auditLog.count()).toBe(2);
  });
  it('public summaries exclude hidden records and private contract facts', async () => {
    const hidden = await createRating(db, 'done', 'renter', { stars: 1 });
    await db.rating.update({ where: { id: hidden.id }, data: { visibility: 'hidden' } });
    await createRating(db, 'bought', 'renter', { stars: 5, comment: 'nice' });
    await createRating(db, 'done', 'provider', { stars: 3 });
    const result = await publicRatings(db, 'provider');
    expect(result.asProvider).toEqual({ count: 1, starSum: 5, averageTenths: 50 });
    expect(result.asRenter.count).toBe(0);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({ reviewerName: 'renter', stars: 5 });
    expect(result.reviews[0]).not.toHaveProperty('contractId');
    expect(result.reviews[0]).not.toHaveProperty('reviewerId');
    expect((await publicRatings(db, 'renter')).asRenter.averageTenths).toBe(30);
  });
  it('only participants may retrieve their own per-contract editor state', async () => {
    expect(await ownContractRating(db, 'done', 'renter')).toBeNull();
    const rating = await createRating(db, 'done', 'renter', { stars: 5 });
    expect((await ownContractRating(db, 'done', 'renter'))?.id).toBe(rating.id);
    await expect(ownContractRating(db, 'done', 'other')).rejects.toMatchObject({ status: 404 });
    await expect(ownContractRating(db, 'absent', 'renter')).rejects.toMatchObject({ status: 404 });
  });
  it('rolls back current rows and evidence when audit fails', async () => {
    const failing = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit failed');
          },
        },
      },
    }) as unknown as PrismaClient;
    await expect(createRating(failing, 'done', 'renter', { stars: 5 })).rejects.toThrow(
      'audit failed'
    );
    expect(await db.rating.count()).toBe(0);
    expect(await db.ratingRevision.count()).toBe(0);
    const rating = await createRating(db, 'done', 'renter', { stars: 2 });
    await expect(
      editRating(failing, rating.id, 'renter', { expectedRevision: 1, stars: 5 })
    ).rejects.toThrow('audit failed');
    expect((await db.rating.findUniqueOrThrow({ where: { id: rating.id } })).stars).toBe(2);
    expect(await db.ratingRevision.count()).toBe(1);
  });
});

describe('rating API tools', () => {
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const request = (user: string | null, body?: unknown, method = 'POST') =>
    new Request('http://localhost/api/ratings', {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { cookie: `lease-loop-user=${user}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  it('requires selected identity and rejects forged subject/reviewer fields', async () => {
    expect((await POST(request(null, { stars: 5 }), context('done'))).status).toBe(401);
    expect((await POST(request('missing', { stars: 5 }), context('done'))).status).toBe(401);
    const invalid = await POST(
      request('renter', { stars: 5, subjectId: 'other' }),
      context('done')
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect((await POST(request('other', { stars: 5 }), context('done'))).status).toBe(403);
    expect(await db.rating.count()).toBe(0);
  });
  it('creates and edits through envelopes, with current revision protection', async () => {
    const created = await POST(
      request('renter', { stars: 3, comment: ' hello ' }),
      context('done')
    );
    expect(created.status).toBe(201);
    const result = await created.json();
    expect(result).toMatchObject({
      success: true,
      data: { stars: 3, comment: 'hello', currentRevision: 1 },
    });
    expect(result.meta.timestamp).toEqual(expect.any(String));
    const edited = await PATCH(
      request('renter', { stars: 4, expectedRevision: 1 }, 'PATCH'),
      context(result.data.id)
    );
    expect(await edited.json()).toMatchObject({
      success: true,
      data: { stars: 4, currentRevision: 2 },
    });
    const stale = await PATCH(
      request('renter', { stars: 1, expectedRevision: 1 }, 'PATCH'),
      context(result.data.id)
    );
    expect(stale.status).toBe(409);
    const duplicate = await POST(request('renter', { stars: 2 }), context('done'));
    expect(duplicate.status).toBe(409);
  });
  it('scopes editor state but exposes sanitized public role summaries', async () => {
    await createRating(db, 'done', 'renter', { stars: 5 });
    const own = await ownGET(request('renter', undefined, 'GET'), context('done'));
    expect(await own.json()).toMatchObject({ success: true, data: { stars: 5 } });
    expect((await ownGET(request('other', undefined, 'GET'), context('done'))).status).toBe(404);
    const summary = await publicGET(request(null, undefined, 'GET'), context('provider'));
    const result = await summary.json();
    expect(result.data.asProvider).toMatchObject({ count: 1, averageTenths: 50 });
    expect(result.data.reviews[0]).not.toHaveProperty('contractId');
  });
});
