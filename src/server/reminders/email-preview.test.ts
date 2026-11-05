import { describe, expect, it } from 'vitest';
import { locales } from '@/i18n/locales';
import { renderEmailPreview, type EmailPreviewInput } from './email-preview';

const input: EmailPreviewInput = {
  locale: 'en',
  itemName: 'Nordvolt Trail 500',
  endOn: '2026-12-05',
  lastCoveredDay: '2026-12-04',
  deadlineAt: '2026-12-04T22:00:00.000Z',
  timeZone: 'Europe/Helsinki',
  timing: { kind: 'days', days: 3 },
  catchUp: false,
  actionPath: '/en/contracts/c1',
};

describe('renderEmailPreview', () => {
  it('states the item, absolute deadline, last day, time left, action and simulation', () => {
    const { subject, text } = renderEmailPreview(input);
    expect(subject).toBe('Your lease of Nordvolt Trail 500 ends soon');
    expect(text).toContain('5 December 2026');
    expect(text).toContain('00:00');
    expect(text).toContain('3 days left');
    expect(text).toContain('The last day it covers is 4 December 2026');
    expect(text).toContain('/en/contracts/c1');
    expect(text).toContain('Nothing was sent outside Lease Loop');
    expect(text).not.toContain('sent late');
  });
  it('shows the deadline in the recipient zone', () => {
    const { text } = renderEmailPreview({ ...input, timeZone: 'Europe/London' });
    expect(text).toContain('4 December 2026');
    expect(text).toContain('22:00');
  });
  it('words singular, hours, catch-up and ended cases', () => {
    expect(renderEmailPreview({ ...input, timing: { kind: 'days', days: 1 } }).text).toContain(
      '(1 day left)'
    );
    expect(renderEmailPreview({ ...input, timing: { kind: 'hours', hours: 5 } }).text).toContain(
      'about 5 hours left'
    );
    expect(renderEmailPreview({ ...input, timing: { kind: 'hours', hours: 1 } }).text).toContain(
      'less than 1 hour left'
    );
    expect(renderEmailPreview({ ...input, catchUp: true }).text).toContain('sent late');
    const ended = renderEmailPreview({ ...input, timing: { kind: 'ended', days: 2 } });
    expect(ended.subject).toBe('Your lease of Nordvolt Trail 500 has ended');
    expect(ended.text).toContain('it ended 2 days ago');
    expect(renderEmailPreview({ ...input, timing: { kind: 'ended', days: 0 } }).text).toContain(
      'it ended today'
    );
    expect(renderEmailPreview({ ...input, timing: { kind: 'ended', days: 1 } }).text).toContain(
      'it ended 1 day ago'
    );
  });
  it('renders every supported language with the item and its own wording', () => {
    const texts = locales.map((locale) =>
      renderEmailPreview({ ...input, locale, timing: { kind: 'ended', days: 3 }, catchUp: true })
    );
    for (const { subject, text } of texts) {
      expect(subject).toContain('Nordvolt Trail 500');
      expect(text).toContain('3');
    }
    expect(new Set(texts.map((t) => t.subject)).size).toBe(locales.length);
    for (const locale of locales) {
      for (const timing of [
        { kind: 'days', days: 1 },
        { kind: 'days', days: 2 },
        { kind: 'hours', hours: 1 },
        { kind: 'hours', hours: 2 },
        { kind: 'ended', days: 0 },
        { kind: 'ended', days: 1 },
      ] as const) {
        expect(renderEmailPreview({ ...input, locale, timing }).text.length).toBeGreaterThan(20);
      }
    }
  });
});
