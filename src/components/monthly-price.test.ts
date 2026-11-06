import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MonthlyPrice } from './monthly-price';

it('changes prominence without hiding or removing VAT', () => {
  const render = (basis: 'net' | 'gross') =>
    renderToStaticMarkup(
      createElement(MonthlyPrice, {
        netCents: 10000,
        grossCents: 12550,
        basis,
        locale: 'en',
      })
    );
  const business = render('net');
  const consumer = render('gross');
  expect(business.indexOf('100.00')).toBeLessThan(business.indexOf('125.50'));
  expect(consumer.indexOf('125.50')).toBeLessThan(consumer.indexOf('100.00'));
  expect(business).toContain('VAT is still included in the amount payable');
  expect(consumer).toContain('VAT included');
  expect(consumer).toContain('VAT excluded');
});
