import { describe, expect, it } from 'vitest';
import { leaseActivity, type AuditRow } from './lease-activity';

const viewer = { id: 'user-liv', displayName: 'Liv Bertani-Green' };
const names = new Map([['provider-pelto', 'Pelto Agri Rental Oy']]);
let next = 0;
const row = (action: string, actor: string, details: unknown = null, at?: string): AuditRow => {
  next += 1;
  return {
    id: next,
    created_at: at ?? `2026-11-0${Math.min(next, 9)}T10:00:00.000Z`,
    actor,
    action,
    details,
  };
};

describe('leaseActivity', () => {
  it('turns signing into an event with the term and rent, newest first', () => {
    const items = leaseActivity(
      [
        row('contract.signed', 'Liv Bertani-Green', { termMonths: 36, monthlyNetCents: 10730 }),
        row('invoices.generated', 'user-liv', { policy: 'advance-monthly-v1' }),
      ],
      viewer,
      names
    );
    expect(items.map((item) => item.event.type)).toEqual(['invoices_issued', 'signed']);
    expect(items[1]).toMatchObject({
      actor: { kind: 'you' },
      event: { type: 'signed', termMonths: 36, monthlyNetCents: 10730 },
    });
  });

  it('names other people and Lease Loop itself', () => {
    const items = leaseActivity(
      [
        row('exit.buyout_paid', 'provider-pelto', {}),
        row('exit.return_finalized', 'system:lifecycle', {}),
        row('exit.return_received', 'someone-unknown', {}),
      ],
      viewer,
      names
    );
    expect(items.map((item) => item.actor)).toEqual([
      { kind: 'person', name: 'someone-unknown' },
      { kind: 'system' },
      { kind: 'person', name: 'Pelto Agri Rental Oy' },
    ]);
  });

  it('reads the early-end quote and the reminder switch', () => {
    const items = leaseActivity(
      [
        row('exit.requested', 'user-liv', {
          kind: 'buyout',
          quote: { amountNetCents: 9544285, effectiveEndOn: '2026-12-05' },
        }),
        row('reminder_preferences.updated', 'user-liv', { preferences: { enabled: false } }),
      ],
      viewer,
      names
    );
    expect(items.map((item) => item.event)).toEqual([
      { type: 'reminders', enabled: false },
      {
        type: 'exit_requested',
        kind: 'buyout',
        amountNetCents: 9544285,
        effectiveEndOn: '2026-12-05',
      },
    ]);
  });

  it('keeps an event with missing details, without inventing them', () => {
    const [item] = leaseActivity([row('contract.signed', 'user-liv', null)], viewer, names);
    expect(item?.event).toEqual({ type: 'signed', termMonths: null, monthlyNetCents: null });
  });

  it('leaves out technical and unknown rows, and malformed ones', () => {
    expect(
      leaseActivity(
        [
          row('contract.participants_recovered', 'system:contract-participants', {}),
          row('something.new', 'user-liv', {}),
          row('exit.requested', 'user-liv', { kind: 'teleport' }),
          row('reminder_preferences.updated', 'user-liv', { preferences: 'on' }),
        ],
        viewer,
        names
      )
    ).toEqual([]);
  });

  it('orders events at the same moment by their log order, newest first', () => {
    const at = '2026-11-06T10:00:00.000Z';
    const items = leaseActivity(
      [row('rating.created', 'user-liv', null, at), row('rating.edited', 'user-liv', null, at)],
      viewer,
      names
    );
    expect(items.map((item) => item.event.type)).toEqual(['rating_edited', 'rated']);
  });
});
