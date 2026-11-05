import { beforeAll, describe, expect, it } from 'vitest';
import { loadCustomers } from '@/data/load';
import type { Customer } from '@/data/schemas';
import { checkBusinessId } from './business-id';

let customers: Customer[];
beforeAll(async () => {
  customers = await loadCustomers();
});

describe('checkBusinessId', () => {
  it('accepts every business ID in the data pack except the deliberate typo', () => {
    const results = Object.fromEntries(
      customers.flatMap((c) =>
        c.type === 'consumer' ? [] : [[c.id, checkBusinessId(c.business_id)]]
      )
    );
    expect(results).toEqual({
      'cust-pekka': { ok: true },
      'cust-kettukoodi': { ok: true },
      'cust-haapala': { ok: true },
      'cust-norvi': { ok: true },
      'cust-broken-id': { ok: false, reason: 'bad_check_digit' },
    });
  });

  it('accepts check digit 0 when the remainder is 0', () => {
    // 0000000: sum 0, remainder 0, so the check digit is 0.
    expect(checkBusinessId('0000000-0')).toEqual({ ok: true });
  });

  it('rejects IDs whose remainder is 1, because none are issued', () => {
    // 1001000: 1·7 + 1·5 = 12, remainder 1, so no check digit can make it valid.
    for (const digit of '0123456789') {
      expect(checkBusinessId(`1001000-${digit}`)).toEqual({ ok: false, reason: 'bad_check_digit' });
    }
  });

  it('ignores surrounding spaces', () => {
    expect(checkBusinessId('  3012456-5 ')).toEqual({ ok: true });
  });

  it('rejects anything that is not seven digits, a hyphen and a digit', () => {
    for (const input of [
      '',
      '3012456',
      '30124565',
      '3012456-',
      '301245-5',
      '3012456–5',
      'FI30124565',
    ]) {
      expect(checkBusinessId(input)).toEqual({ ok: false, reason: 'bad_format' });
    }
  });
});
