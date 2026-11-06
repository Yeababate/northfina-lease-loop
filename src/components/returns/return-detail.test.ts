import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { recordInspection, recordWork } from '@/server/next-life-commands';
import { getReturn } from '@/server/next-life-reads';
import { assignWaitingListEntry, seedWaitingList } from '@/server/waiting-list';
import { DAY_ONE, withScenario } from '../../../tests/scenarios/fixtures';
import { ReturnDetail } from './return-detail';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it('offers named preparation for a fair placement after its mandatory work', async () => {
  await withScenario(async (db) => {
    const provider = 'provider-kettu';
    const intake = 'seed-ebike-007';
    await seedWaitingList(db);
    await recordInspection(
      db,
      provider,
      intake,
      { expectedRevision: 0, condition: 'fair', usageValue: 18400, hoursSinceService: null },
      DAY_ONE
    );
    await assignWaitingListEntry(db, provider, intake, 'wait-02', DAY_ONE);
    await recordWork(
      db,
      provider,
      intake,
      { expectedRevision: 1, actionId: 'battery_replacement' },
      DAY_ONE
    );
    await recordWork(
      db,
      provider,
      intake,
      { expectedRevision: 2, actionId: 'safety_inspection' },
      DAY_ONE
    );
    const detail = await getReturn(db, provider, intake, DAY_ONE);
    expect(detail).toMatchObject({
      canRelist: true,
      current: { condition: 'fair' },
      placement: { id: 'wait-02', participantId: null },
    });
    expect(detail.outstanding).toEqual([]);
    const html = renderToStaticMarkup(
      createElement(ReturnDetail, {
        locale: 'en',
        detail,
        matches: null,
        recipients: [{ id: 'cust-aino', displayName: 'Aino Virtanen' }],
      })
    );
    expect(html).toContain('Customer accepting this offer');
    expect(html).toContain('Prepare this customer');
    expect(html).toContain('Aino Virtanen');
    expect(html).not.toContain('upgrade:fair-&gt;good');
  });
});

it('prefills the existing condition and mileage instead of downgrading a good return', async () => {
  await withScenario(async (db) => {
    const detail = await getReturn(db, 'provider-kettu', 'seed-ebike-008', DAY_ONE);
    const html = renderToStaticMarkup(
      createElement(ReturnDetail, {
        locale: 'en',
        detail,
        matches: null,
      })
    );
    expect(html).toContain('value="good" selected=""');
    expect(html).toContain('value="9800"');
    expect(html).not.toContain('Customer accepting this offer');
  });
});
