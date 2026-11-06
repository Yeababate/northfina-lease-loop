import { describe, expect, it } from 'vitest';
import {
  canModerate,
  canReport,
  existingReport,
  moderationTransition,
  validateReport,
} from './moderation';

const rating = { subjectId: 'subject', authorId: 'author', revision: 1, visibility: 'visible' };
const context = {
  action: 'keep' as const,
  status: 'pending' as const,
  visibility: 'visible',
  reportVersion: 0,
  expectedReportVersion: 0,
  ratingRevision: 1,
  expectedRatingRevision: 1,
  moderationVersion: 0,
  expectedModerationVersion: 0,
  rationale: ' Reviewed evidence ',
};
describe('report permissions and validation', () => {
  it('permits only the subject, in either direction', () => {
    expect(canReport('subject', rating)).toBe(true);
    for (const id of ['author', 'reader', null]) expect(canReport(id, rating)).toBe(false);
    expect(canReport('subject', { ...rating, authorId: 'subject' })).toBe(false);
    expect(canReport('author', { ...rating, authorId: 'subject', subjectId: 'author' })).toBe(true);
  });
  it('requires trusted moderator capability', () => {
    expect(canModerate(null)).toBe(false);
    expect(canModerate({ id: 'subject', isModerator: false })).toBe(false);
    expect(canModerate({ id: 'moderator', isModerator: true })).toBe(true);
  });
  it('validates reason and optional trimmed explanation boundaries', () => {
    for (const reason of ['abusive', 'misleading', 'spam', 'other'])
      expect(validateReport(reason, '  text  ')).toEqual({ ok: true, reason, explanation: 'text' });
    expect(validateReport('other', '')).toMatchObject({ ok: true });
    expect(validateReport('other', 'a'.repeat(2000))).toMatchObject({ ok: true });
    expect(validateReport('other', 'a'.repeat(2001))).toMatchObject({ ok: false });
    expect(validateReport('invalid', '')).toMatchObject({ ok: false });
    expect(validateReport('other', null)).toMatchObject({ ok: false });
  });
  it('reuses only the same subject and revision case', () => {
    const report = { ratingId: 'r', ratingRevision: 1, reporterId: 'subject' };
    expect(existingReport([report], 'r', 1, 'subject')).toBe(report);
    expect(existingReport([report], 'r', 2, 'subject')).toBeUndefined();
    expect(existingReport([report], 'other', 1, 'subject')).toBeUndefined();
    expect(existingReport([report], 'r', 1, 'reader')).toBeUndefined();
    expect(existingReport([], 'r', 1, 'subject')).toBeUndefined();
  });
});
describe('moderation transitions', () => {
  it('keeps visibility unchanged on Keep, including an already hidden rating', () => {
    expect(moderationTransition(context)).toMatchObject({
      ok: true,
      status: 'kept',
      visibility: 'visible',
      rationale: 'Reviewed evidence',
    });
    expect(moderationTransition({ ...context, visibility: 'hidden' })).toMatchObject({
      visibility: 'hidden',
    });
  });
  it('hides and restores without erasing the case outcome', () => {
    expect(moderationTransition({ ...context, action: 'hide' })).toMatchObject({
      ok: true,
      status: 'hidden',
      visibility: 'hidden',
    });
    expect(
      moderationTransition({
        ...context,
        action: 'restore',
        status: 'hidden',
        visibility: 'hidden',
      })
    ).toMatchObject({ ok: true, status: 'hidden', visibility: 'visible' });
    expect(moderationTransition({ ...context, action: 'restore' })).toMatchObject({
      reason: 'not_hidden',
    });
  });
  it('rejects stale content, case and visibility versions independently', () => {
    for (const update of [{ ratingRevision: 2 }, { reportVersion: 1 }, { moderationVersion: 1 }])
      expect(moderationTransition({ ...context, ...update })).toMatchObject({
        reason: 'stale_context',
      });
  });
  it('rejects repeat resolutions and invalid rationale', () => {
    expect(moderationTransition({ ...context, status: 'kept' })).toMatchObject({
      reason: 'already_resolved',
    });
    for (const rationale of ['', '  ', null, 'a'.repeat(2001)])
      expect(moderationTransition({ ...context, rationale })).toMatchObject({
        reason: 'invalid_rationale',
      });
    expect(moderationTransition({ ...context, rationale: 'a'.repeat(2000) })).toMatchObject({
      ok: true,
    });
  });
});
