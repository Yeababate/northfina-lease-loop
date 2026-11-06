import { describe, expect, it } from 'vitest';
import { DEMO_PROVIDERS } from '@/server/providers';
import { loadCustomers, loadDealerLocations } from './load';
import { dealerLocationsFileSchema } from './schemas';

const valid = {
  note: 'test',
  dealers: [{ id: 'd-1', provider_id: 'p', name: 'D', area: 'Oulu', lat: 65.0, lon: 25.5 }],
  cities: [{ name: 'Oulu', lat: 65.0, lon: 25.5 }],
};

describe('data/dealer-locations.json', () => {
  it('has six dealers in the six agreed cities', async () => {
    const file = await loadDealerLocations();
    expect(file.dealers.map((d) => d.area).sort()).toEqual(
      ['Helsinki', 'Jyväskylä', 'Kuopio', 'Oulu', 'Tampere', 'Turku'].sort()
    );
  });

  it('attaches every dealer to a demo provider company, never a private person', async () => {
    const companies = new Set(
      DEMO_PROVIDERS.filter((p) => p.id.startsWith('provider-')).map((p) => p.id)
    );
    for (const dealer of (await loadDealerLocations()).dealers) {
      expect(companies.has(dealer.provider_id), dealer.id).toBe(true);
    }
  });

  it('has a home city for every Finnish or Estonian demo customer', async () => {
    const [file, customers] = await Promise.all([loadDealerLocations(), loadCustomers()]);
    const cities = new Set(file.cities.map((c) => c.name));
    for (const customer of customers) expect(cities.has(customer.city), customer.city).toBe(true);
  });
});

describe('dealerLocationsFileSchema', () => {
  it('accepts coarse coordinates', () => {
    expect(dealerLocationsFileSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects coordinates finer than 0.1°', () => {
    const fine = { ...valid, dealers: [{ ...valid.dealers[0], lat: 65.01 }] };
    expect(dealerLocationsFileSchema.safeParse(fine).success).toBe(false);
    const fineCity = { ...valid, cities: [{ name: 'Oulu', lat: 65, lon: 25.55 }] };
    expect(dealerLocationsFileSchema.safeParse(fineCity).success).toBe(false);
  });

  it('rejects a street address field and out-of-range coordinates', () => {
    const address = { ...valid, dealers: [{ ...valid.dealers[0], address: 'Kauppatori 1' }] };
    expect(dealerLocationsFileSchema.safeParse(address).success).toBe(false);
    const range = { ...valid, cities: [{ name: 'X', lat: 95, lon: 0 }] };
    expect(dealerLocationsFileSchema.safeParse(range).success).toBe(false);
  });

  it('rejects duplicate dealer ids and city names', () => {
    const dupDealer = { ...valid, dealers: [valid.dealers[0], valid.dealers[0]] };
    expect(dealerLocationsFileSchema.safeParse(dupDealer).success).toBe(false);
    const dupCity = { ...valid, cities: [valid.cities[0], valid.cities[0]] };
    expect(dealerLocationsFileSchema.safeParse(dupCity).success).toBe(false);
  });
});
