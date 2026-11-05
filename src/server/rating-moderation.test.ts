import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../tests/helpers/test-db';
import type { PrismaClient } from './prisma-client';
import { submitRatingReport, listOwnRatingReports } from './rating-reports';
import {
  decideRatingReport,
  getModerationReport,
  listModerationReports,
} from './rating-moderation';
import { demoNameCookieHeader } from './demo-cookie';
import { seedModerator } from './moderator-seed';
import { publicRatings, editRating } from './ratings';
import { GET as publicRatingsGet } from '@/app/api/users/[id]/ratings/route';
import { GET as publicAuditGet } from '@/app/api/audit-log/route';
import { POST as reportPost, GET as reportGet } from '@/app/api/ratings/[id]/reports/route';
import { GET as ownGet } from '@/app/api/rating-reports/route';
import { GET as queueGet } from '@/app/api/moderation/reports/route';
import { GET as detailGet, POST as decisionPost } from '@/app/api/moderation/reports/[id]/route';
vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
let db: PrismaClient;
let cleanup: () => Promise<void>;
const submission = { expectedRevision: 1, reason: 'abusive', explanation: '  harmful text  ' };
const decision = {
  action: 'hide' as const,
  rationale: 'Personal abuse',
  expectedReportVersion: 0,
  expectedRatingRevision: 1,
  expectedModerationVersion: 0,
};
const context = (id: string) => ({ params: Promise.resolve({ id }) });
/** Identity is the demo sign-in name (main's design): test users' names equal their ids, and
 * the seeded moderator (id demo-moderator) signs in as "moderator". */
const signInNameFor = (id: string) => (id === 'demo-moderator' ? 'moderator' : id);
const request = (url: string, actor: string | null, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(actor ? { cookie: demoNameCookieHeader(signInNameFor(actor)) } : {}),
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.moderationDecision.deleteMany();
  await db.ratingReport.deleteMany();
  await db.ratingRevision.deleteMany();
  await db.rating.deleteMany();
  await db.demoUser.deleteMany();
  await db.auditLog.deleteMany();
  await db.demoUser.createMany({
    data: ['subject', 'author', 'reader'].map((id) => ({
      id,
      canonicalUsername: id,
      displayName: id,
    })),
  });
  await seedModerator(db);
  await db.rating.create({
    data: {
      id: 'rating',
      contractId: 'contract',
      reviewerId: 'author',
      subjectId: 'subject',
      direction: 'renter_to_provider',
      stars: 1,
      comment: 'Original abusive text',
      revisions: {
        create: {
          id: 'rev1',
          revision: 1,
          stars: 1,
          comment: 'Original abusive text',
          authorId: 'author',
        },
      },
    },
  });
  await db.auditLog.deleteMany();
});
async function report() {
  return submitRatingReport(db, 'subject', 'rating', submission);
}
async function edit() {
  await db.rating.update({
    where: { id: 'rating' },
    data: {
      currentRevision: 2,
      stars: 4,
      comment: 'Edited',
      revisions: {
        create: { id: 'rev2', revision: 2, stars: 4, comment: 'Edited', authorId: 'author' },
      },
    },
  });
}
async function summary() {
  return (await publicRatings(db, 'subject')).asProvider;
}
describe('subject reports', () => {
  it('retains immutable evidence and counts while pending; duplicate submissions reuse the case', async () => {
    const first = await report();
    expect(await report()).toEqual(first);
    expect(first).toMatchObject({ status: 'pending', explanation: 'harmful text' });
    expect(await summary()).toMatchObject({ count: 1, starSum: 1 });
    expect(await db.auditLog.count()).toBe(1);
    await edit();
    expect(await report()).toEqual(first);
    const second = await submitRatingReport(db, 'subject', 'rating', {
      ...submission,
      expectedRevision: 2,
    });
    expect(second.id).not.toBe(first.id);
    const detail = await getModerationReport(db, 'demo-moderator', first.id);
    expect(detail.reportedRevision.comment).toBe('Original abusive text');
    expect(detail.rating.comment).toBe('Edited');
    expect(detail.rating.revisions).toHaveLength(2);
  });
  it('handles concurrent duplicate submissions with one case and one audit', async () => {
    const cases = await Promise.all([report(), report(), report()]);
    expect(new Set(cases.map((item) => item.id)).size).toBe(1);
    expect(await db.ratingReport.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });
  it('rejects author, unrelated user, missing identity/rating, invalid input and stale content', async () => {
    for (const actor of ['author', 'reader'])
      await expect(submitRatingReport(db, actor, 'rating', submission)).rejects.toMatchObject({
        code: 'SUBJECT_REQUIRED',
      });
    await expect(submitRatingReport(db, 'missing', 'rating', submission)).rejects.toMatchObject({
      status: 401,
    });
    await expect(submitRatingReport(db, 'subject', 'missing', submission)).rejects.toMatchObject({
      status: 404,
    });
    for (const input of [
      { reason: '' },
      { explanation: 'a'.repeat(2001) },
      { explanation: null },
      { expectedRevision: 0 },
    ])
      await expect(
        submitRatingReport(db, 'subject', 'rating', { ...submission, ...input })
      ).rejects.toMatchObject({ status: 422 });
    await edit();
    await expect(report()).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    expect(await db.ratingReport.count()).toBe(0);
  });
  it('restricts private outcomes and excludes moderator details from the subject projection', async () => {
    const first = await report();
    await decideRatingReport(db, 'demo-moderator', first.id, decision);
    expect(await listOwnRatingReports(db, 'reader')).toEqual([]);
    const own = await listOwnRatingReports(db, 'subject');
    expect(own[0]).toMatchObject({ status: 'hidden' });
    for (const key of ['reporterId', 'decisions', 'rationale', 'moderatorId', 'rating'])
      expect(own[0]).not.toHaveProperty(key);
    await expect(listOwnRatingReports(db, 'missing')).rejects.toMatchObject({ status: 401 });
  });
});
describe('moderator decisions', () => {
  it('requires a trusted capability for every queue, detail and decision service', async () => {
    const first = await report();
    for (const actor of ['subject', 'author', 'reader', 'missing']) {
      await expect(listModerationReports(db, actor)).rejects.toMatchObject({ status: 403 });
      await expect(getModerationReport(db, actor, first.id)).rejects.toMatchObject({ status: 403 });
      await expect(decideRatingReport(db, actor, first.id, decision)).rejects.toMatchObject({
        status: 403,
      });
    }
    await expect(getModerationReport(db, 'demo-moderator', 'missing')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      decideRatingReport(db, 'demo-moderator', 'missing', decision)
    ).rejects.toMatchObject({ status: 404 });
  });
  it('Keep leaves public scores intact and does not resolve twice', async () => {
    const first = await report();
    await decideRatingReport(db, 'demo-moderator', first.id, { ...decision, action: 'keep' });
    expect(await summary()).toMatchObject({ count: 1, starSum: 1 });
    expect(await listModerationReports(db, 'demo-moderator')).toEqual([]);
    expect(await listModerationReports(db, 'demo-moderator', true)).toHaveLength(1);
    await expect(
      decideRatingReport(db, 'demo-moderator', first.id, {
        ...decision,
        expectedReportVersion: 1,
        expectedModerationVersion: 1,
      })
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('hides the current rating, preserves hidden state after edits, and restores the latest revision with history', async () => {
    const first = await report();
    await decideRatingReport(db, 'demo-moderator', first.id, decision);
    expect(await summary()).toMatchObject({ count: 0, starSum: 0 });
    await edit();
    expect(await summary()).toMatchObject({ count: 0 });
    await decideRatingReport(db, 'demo-moderator', first.id, {
      ...decision,
      action: 'restore',
      rationale: 'Edited text reviewed',
      expectedReportVersion: 1,
      expectedRatingRevision: 2,
      expectedModerationVersion: 1,
    });
    expect(await summary()).toMatchObject({ count: 1, starSum: 4 });
    const detail = await getModerationReport(db, 'demo-moderator', first.id);
    expect(detail.status).toBe('hidden');
    expect(detail.rating.reports[0]!.decisions.map((item) => item.action)).toEqual([
      'hide',
      'restore',
    ]);
    expect(await db.auditLog.count()).toBe(3);
    expect(await db.moderationDecision.findFirst({ where: { action: 'restore' } })).toMatchObject({
      reviewedRevisionId: 'rev2',
      previousVisibility: 'hidden',
      resultingVisibility: 'visible',
    });
  });
  it('rejects stale content, another case visibility decision, invalid rationale and invalid action', async () => {
    const first = await report();
    await edit();
    await expect(
      decideRatingReport(db, 'demo-moderator', first.id, decision)
    ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    const second = await submitRatingReport(db, 'subject', 'rating', {
      ...submission,
      expectedRevision: 2,
    });
    await decideRatingReport(db, 'demo-moderator', second.id, {
      ...decision,
      expectedRatingRevision: 2,
    });
    await expect(
      decideRatingReport(db, 'demo-moderator', first.id, { ...decision, expectedRatingRevision: 2 })
    ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    for (const rationale of ['', ' ', 'a'.repeat(2001)])
      await expect(
        decideRatingReport(db, 'demo-moderator', first.id, {
          ...decision,
          rationale,
          expectedRatingRevision: 2,
          expectedModerationVersion: 1,
        })
      ).rejects.toMatchObject({ status: 422 });
    await expect(
      decideRatingReport(db, 'demo-moderator', first.id, {
        ...decision,
        action: 'invalid' as 'hide',
      })
    ).rejects.toMatchObject({ status: 422 });
  });
  it('only one concurrent decision commits', async () => {
    const first = await report();
    const outcomes = await Promise.allSettled([
      decideRatingReport(db, 'demo-moderator', first.id, decision),
      decideRatingReport(db, 'demo-moderator', first.id, { ...decision, action: 'keep' }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.moderationDecision.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(2);
  });
});
function failingAudit() {
  return db.$extends({
    query: {
      auditLog: {
        create() {
          throw new Error('audit unavailable');
        },
      },
    },
  }) as unknown as PrismaClient;
}
it('rolls back submission and all decision writes if the audit fails', async () => {
  await expect(submitRatingReport(failingAudit(), 'subject', 'rating', submission)).rejects.toThrow(
    'audit unavailable'
  );
  expect(await db.ratingReport.count()).toBe(0);
  const first = await report();
  await expect(
    decideRatingReport(failingAudit(), 'demo-moderator', first.id, decision)
  ).rejects.toThrow('audit unavailable');
  expect(await db.ratingReport.findUnique({ where: { id: first.id } })).toMatchObject({
    status: 'pending',
    version: 0,
  });
  expect(await db.rating.findUnique({ where: { id: 'rating' } })).toMatchObject({
    visibility: 'visible',
    moderationVersion: 0,
  });
  expect(await db.moderationDecision.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(1);
});
it('seeds the moderator idempotently and audits promotion of an existing demo account', async () => {
  await seedModerator(db);
  expect(await db.auditLog.count()).toBe(0);
  await db.demoUser.update({ where: { id: 'demo-moderator' }, data: { moderator: false } });
  await seedModerator(db);
  expect(await db.auditLog.count()).toBe(1);
});
it('API enforces cookie identity, strict inputs and envelopes for report/queue/detail/decision routes', async () => {
  expect(
    (await reportPost(request('/api/ratings/rating/reports', null, submission), context('rating')))
      .status
  ).toBe(401);
  expect(
    (
      await reportPost(
        request('/api/ratings/rating/reports', 'author', submission),
        context('rating')
      )
    ).status
  ).toBe(403);
  expect(
    (
      await reportPost(
        request('/api/ratings/rating/reports', 'subject', { ...submission, reporterId: 'author' }),
        context('rating')
      )
    ).status
  ).toBe(400);
  const response = await reportPost(
    request('/api/ratings/rating/reports', 'subject', submission),
    context('rating')
  );
  const body = await response.json();
  expect(body).toMatchObject({ success: true, data: { status: 'pending' } });
  expect(
    (await reportGet(request('/api/ratings/rating/reports', 'subject'), context('rating'))).status
  ).toBe(200);
  expect((await ownGet(request('/api/rating-reports', 'reader'), undefined)).status).toBe(200);
  expect((await queueGet(request('/api/moderation/reports', 'subject'), undefined)).status).toBe(
    403
  );
  expect(
    (await queueGet(request('/api/moderation/reports?all=1', 'demo-moderator'), undefined)).status
  ).toBe(200);
  expect(
    (await detailGet(request('/api/moderation/reports/x', 'reader'), context(body.data.id))).status
  ).toBe(403);
  expect(
    (await detailGet(request('/api/moderation/reports/x', 'demo-moderator'), context(body.data.id)))
      .status
  ).toBe(200);
  expect(
    (
      await decisionPost(
        request('/api/moderation/reports/x', 'subject', decision),
        context(body.data.id)
      )
    ).status
  ).toBe(403);
  expect(
    (
      await decisionPost(
        request('/api/moderation/reports/x', 'demo-moderator', { ...decision, moderator: true }),
        context(body.data.id)
      )
    ).status
  ).toBe(400);
  expect(
    (
      await decisionPost(
        request('/api/moderation/reports/x', 'demo-moderator', decision),
        context(body.data.id)
      )
    ).status
  ).toBe(200);
  expect(
    (
      await decisionPost(
        request('/api/moderation/reports/x', 'demo-moderator', decision),
        context(body.data.id)
      )
    ).status
  ).toBe(409);
});

it('public audit responses omit report identities, notes and even case identifiers', async () => {
  const first = await report();
  await decideRatingReport(db, 'demo-moderator', first.id, decision);
  const response = await publicAuditGet(new Request('http://localhost/api/audit-log'), undefined);
  expect(await response.json()).toMatchObject({ success: true, data: [] });
  expect(await db.auditLog.count()).toBe(2);
});

it('integrates actual rating edits and public queries across report, Hide and Restore', async () => {
  const first = await report();
  await editRating(db, 'rating', 'author', {
    expectedRevision: 1,
    stars: 2,
    comment: 'Second revision',
  });
  const evidence = await getModerationReport(db, 'demo-moderator', first.id);
  expect(evidence.reportedRevision).toMatchObject({
    revision: 1,
    comment: 'Original abusive text',
  });
  expect(evidence.rating).toMatchObject({ currentRevision: 2, comment: 'Second revision' });
  await expect(decideRatingReport(db, 'demo-moderator', first.id, decision)).rejects.toMatchObject({
    code: 'STALE_CONTEXT',
  });
  await decideRatingReport(db, 'demo-moderator', first.id, {
    ...decision,
    expectedRatingRevision: 2,
  });
  expect(await publicRatings(db, 'subject')).toMatchObject({
    asProvider: { count: 0 },
    reviews: [],
  });
  await editRating(db, 'rating', 'author', {
    expectedRevision: 2,
    stars: 5,
    comment: 'Third revision',
  });
  expect(await publicRatings(db, 'subject')).toMatchObject({
    asProvider: { count: 0 },
    reviews: [],
  });
  await decideRatingReport(db, 'demo-moderator', first.id, {
    ...decision,
    action: 'restore',
    rationale: 'Latest revision reviewed',
    expectedReportVersion: 1,
    expectedRatingRevision: 3,
    expectedModerationVersion: 1,
  });
  const response = await publicRatingsGet(
    request('/api/users/subject/ratings', null),
    context('subject')
  );
  const body = await response.json();
  expect(body).toMatchObject({
    success: true,
    data: { asProvider: { count: 1, starSum: 5 }, reviews: [{ comment: 'Third revision' }] },
  });
  const review = body.data.reviews[0];
  for (const field of [
    'reporterId',
    'reports',
    'decisions',
    'rationale',
    'moderatorId',
    'revisionId',
    'moderationVersion',
  ])
    expect(review).not.toHaveProperty(field);
  expect((await getModerationReport(db, 'demo-moderator', first.id)).reportedRevision.comment).toBe(
    'Original abusive text'
  );
});
it('restoration rolls back publication and decision history if its audit fails', async () => {
  const first = await report();
  await decideRatingReport(db, 'demo-moderator', first.id, decision);
  await expect(
    decideRatingReport(failingAudit(), 'demo-moderator', first.id, {
      ...decision,
      action: 'restore',
      expectedReportVersion: 1,
      expectedModerationVersion: 1,
    })
  ).rejects.toThrow('audit unavailable');
  expect(await publicRatings(db, 'subject')).toMatchObject({
    reviews: [],
    asProvider: { count: 0 },
  });
  expect(await db.moderationDecision.count()).toBe(1);
  expect(await db.auditLog.count()).toBe(2);
});
it('enforces subject reporting in the provider-to-renter direction as well', async () => {
  await db.rating.update({
    where: { id: 'rating' },
    data: { direction: 'provider_to_renter', reviewerId: 'subject', subjectId: 'author' },
  });
  await expect(report()).rejects.toMatchObject({ code: 'SUBJECT_REQUIRED' });
  const reported = await submitRatingReport(db, 'author', 'rating', submission);
  expect(reported.status).toBe('pending');
  expect((await publicRatings(db, 'author')).asRenter).toMatchObject({ count: 1, starSum: 1 });
});
