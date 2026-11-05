// Initial reminder settings are saved by the signing API, in the signing transaction.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/contracts/route';
import { loadAssets } from '@/data/load';
import { createTestDb } from '../../../tests/helpers/test-db';
import { clearReminderData } from '../../../tests/helpers/reminders';
import { seedAssets } from '../assets';
import type { PrismaClient } from '../prisma-client';
import { getReminderSettings } from './preferences';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));
vi.mock('@/server/demo-session', () => ({ readDemoName: async () => 'Aino Virtanen' }));

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await clearReminderData(db);
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
});

const application = {
  assetId: 'ebike-003',
  termMonths: 36,
  downPaymentCents: 0,
  startOn: '2026-11-05',
  answers: {
    q_customer_type: 'consumer',
    q_full_name: 'Aino Virtanen',
    q_birth_date: '1992-03-14',
    q_email: 'aino@example.com',
    q_country: 'FI',
    q_employment: 'employed',
    q_monthly_income: 320000,
    q_usage_purpose: 'commuting',
  },
  expectedMonthlyNetCents: 10730,
  expectedPriceListVersion: 1,
};
const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    undefined
  );

describe('signing with reminder settings', () => {
  it('saves default 30/7/1 reminders in Helsinki time when none are sent', async () => {
    const response = await post(application);
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { id: string; endOn: string } };
    const settings = await getReminderSettings(db, data.id, 'Aino Virtanen');
    expect(settings.preferences.timeZone).toBe('Europe/Helsinki');
    expect(settings.schedule.map((s) => [s.daysBefore, s.localDate, s.localTime])).toEqual([
      [30, '2029-10-06', '09:00'],
      [7, '2029-10-29', '09:00'],
      [1, '2029-11-04', '09:00'],
    ]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'contract.signed' } });
    expect(JSON.parse(audit.details_json!)).toHaveProperty('reminderPreferences.enabled', true);
  });

  it('saves the customer’s own channels, times, zone and language', async () => {
    const response = await post({
      ...application,
      locale: 'et',
      reminders: {
        enabled: true,
        timeZone: 'Europe/Tallinn',
        rules: [{ id: 'r1', daysBefore: 14, time: '18:15', channels: ['email'], enabled: true }],
      },
    });
    const { data } = (await response.json()) as { data: { id: string } };
    const settings = await getReminderSettings(db, data.id, 'Aino Virtanen');
    expect(settings.locale).toBe('et');
    expect(settings.schedule).toMatchObject([
      { ruleId: 'r1', localTime: '18:15', timeZone: 'Europe/Tallinn', channels: ['email'] },
    ]);
  });

  it('refuses invalid reminder settings and signs nothing', async () => {
    const response = await post({
      ...application,
      reminders: { enabled: true, timeZone: '+02:00', rules: [] },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REMINDERS' } });
    expect(await db.contract.count()).toBe(0);
    expect(await db.reminderPreference.count()).toBe(0);
    expect((await db.asset.findUniqueOrThrow({ where: { id: 'ebike-003' } })).status).toBe(
      'available'
    );
  });
});
