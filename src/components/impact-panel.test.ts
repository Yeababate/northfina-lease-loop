import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImpactEstimateResult } from '@/domain/co2-impact';
import { getT } from '@/i18n/get-t';
import { ItemImpactPanel } from './impact-panel';

// Only the fields the panel reads; the rest of the estimate is irrelevant here.
const result = {
  ok: true,
  estimate: {
    estimatedSavingGrams: 95_000,
    outcome: 'saving',
    manufacturingBaselineGrams: 165_000,
    creditedManufacturingGrams: 115_000,
    refurbishmentAllowanceGrams: 20_000,
    assumptions: [],
  },
} as unknown as ImpactEstimateResult;

const render = (quantity?: number) =>
  renderToStaticMarkup(
    createElement(ItemImpactPanel, { result, quantity, locale: 'en', t: getT('en') })
  ).replace(/<[^>]+>/g, ' ');

describe('ItemImpactPanel', () => {
  it('speaks about one item by default', () => {
    const text = render();
    expect(text).toContain('About 95 kg of CO₂ saved by leasing this item');
    expect(text).toContain('Making a new one');
  });

  it('uses the plural and multiplies every figure for several items', () => {
    const text = render(4);
    expect(text).toContain('About 380 kg of CO₂ saved by leasing these 4 items');
    expect(text).toContain('Making 4 new ones');
    expect(text).toContain('660 kg'); // 4 × 165 kg
    expect(text).toContain('−80 kg'); // 4 × 20 kg refurbishment
  });
});
