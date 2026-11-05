import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { getT } from '@/i18n/get-t';
import { createTestDb } from '../../tests/helpers/test-db';
import { GET as profileGet } from '@/app/api/profile/route';
import { GET as contractGet } from '@/app/api/contracts/[id]/route';
import { GET as documentGet } from '@/app/documents/contracts/[id]/route';
import { seedAssets } from './assets';
import { demoNameCookieHeader } from './demo-cookie';
import { seedDemoParticipants } from './demo-participants';
import { seedDealerSide } from './providers';
import { signContract } from './contracts';
import {
  getParticipantContract,
  getParticipantDocument,
  listParticipantContracts,
} from './profile';
import { documentIntegrityMatches } from './contract-pdf';
import type { PrismaClient } from './prisma-client';

vi.mock('@/server/db', () => ({
  get db() {
    return db;
  },
}));
vi.mock('@/server/today', () => ({ todayIso: () => '2026-11-05' }));
let db: PrismaClient;
let cleanup: () => Promise<void>;
let lists: Awaited<ReturnType<typeof loadPriceLists>>;
let table: Awaited<ReturnType<typeof loadCoefficientTable>>;
const choice = {
  assetId: 'ebike-003',
  actor: 'Õie Ääkkönen',
  termMonths: 36,
  downPaymentCents: 0,
  expectedMonthlyNetCents: 10730,
  expectedBuyoutNetCents: 58350,
  expectedPriceListVersion: 1,
};
const participants = {
  renterId: 'cust-aino',
  providerId: 'provider-kettu',
  providerName: 'Kettu Mobility Oy',
  locale: 'en' as const,
};
/** A request from the visitor signed in with this demo name. */
const request = (name = 'Aino') =>
  new Request('http://localhost/api/profile', { headers: { cookie: demoNameCookieHeader(name) } });
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  [lists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.contract.deleteMany();
  await db.asset.deleteMany();
  await seedAssets(db, await loadAssets());
  await seedDemoParticipants(db);
  await db.auditLog.deleteMany();
});

describe('saved originals', () => {
  it.each(['en', 'fi', 'sv', 'et'] as const)(
    'saves a genuine Unicode-font PDF in signing locale %s',
    async (locale) => {
      const contract = await signContract(
        db,
        { ...choice, participants: { ...participants, locale } },
        '2026-11-05',
        lists,
        table
      );
      const original = await getParticipantDocument(db, 'cust-aino', contract.id);
      expect(original.locale).toBe(locale);
      expect(documentIntegrityMatches(original)).toBe(true);
      expect(Buffer.from(original.bytes).subarray(0, 5).toString()).toBe('%PDF-');
      const pdf = await PDFDocument.load(original.bytes);
      expect(pdf.getTitle()).toContain(getT(locale)('contract.title'));
      expect(pdf.catalog.get(PDFName.of('Lang'))?.toString()).toContain(locale);
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      const stored = await db.contract.findUniqueOrThrow({
        where: { id: contract.id },
        include: { lines: true, lifecycle: true },
      });
      expect(stored.lines).toHaveLength(1);
      expect(stored.lines[0]).toMatchObject({ assetId: choice.assetId, monthlyNetCents: 10730 });
      expect(stored.lifecycle?.status).toBe('active');
      expect(
        await db.auditLog.findFirstOrThrow({ where: { entity_id: contract.id } })
      ).toMatchObject({ actor: participants.renterId });
      const changed = structuredClone(lists);
      changed[0]!.prices[choice.assetId] = 999999;
      expect((await getParticipantDocument(db, 'provider-kettu', contract.id)).bytes).toEqual(
        original.bytes
      );
      const reply = await documentGet(request('KETTU'), {
        params: Promise.resolve({ id: contract.id }),
      });
      expect(reply.status).toBe(200);
      expect(reply.headers.get('Content-Language')).toBe(locale);
      expect(new Uint8Array(await reply.arrayBuffer())).toEqual(original.bytes);
      expect(
        (await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).monthlyNetCents
      ).toBe(10730);
    }
  );
  it('rejects foreign/missing contracts and corrupt/missing originals without regeneration', async () => {
    const contract = await signContract(
      db,
      { ...choice, participants },
      '2026-11-05',
      lists,
      table
    );
    await expect(getParticipantContract(db, 'cust-mikko', contract.id)).rejects.toMatchObject({
      code: 'CONTRACT_NOT_FOUND',
    });
    expect(
      (await documentGet(request('mikko'), { params: Promise.resolve({ id: contract.id }) })).status
    ).toBe(404);
    expect(
      (
        await documentGet(new Request('http://localhost'), {
          params: Promise.resolve({ id: contract.id }),
        })
      ).status
    ).toBe(401);
    await db.contractDocument.update({
      where: { contractId: contract.id },
      data: { sha256: 'corrupt' },
    });
    await expect(getParticipantDocument(db, 'cust-aino', contract.id)).rejects.toMatchObject({
      code: 'DOCUMENT_UNAVAILABLE',
    });
    await db.contractDocument.delete({ where: { contractId: contract.id } });
    await expect(getParticipantDocument(db, 'cust-aino', contract.id)).rejects.toMatchObject({
      code: 'DOCUMENT_UNAVAILABLE',
    });
    expect(await db.contractDocument.count()).toBe(0);
  });
  it('wraps long Unicode fields and paginates the saved original', async () => {
    await db.asset.update({
      where: { id: choice.assetId },
      data: {
        make: 'Ää '.repeat(150),
        model: 'Õun '.repeat(150),
        serial_number: 'ä'.repeat(600),
      },
    });
    const contract = await signContract(
      db,
      { ...choice, participants, actor: 'Õie '.repeat(120) },
      '2026-11-05',
      lists,
      table
    );
    const original = await getParticipantDocument(db, participants.renterId, contract.id);
    expect((await PDFDocument.load(original.bytes)).getPageCount()).toBeGreaterThan(1);
  });
  it('rolls back original, line, lifecycle and reservation if audit fails', async () => {
    const failing = db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit down');
          },
        },
      },
    });
    await expect(
      signContract(
        failing as unknown as PrismaClient,
        { ...choice, participants },
        '2026-11-05',
        lists,
        table
      )
    ).rejects.toThrow('audit down');
    expect(await db.contract.count()).toBe(0);
    expect(await db.contractLine.count()).toBe(0);
    expect(await db.contractDocument.count()).toBe(0);
    expect(await db.contractLifecycle.count()).toBe(0);
    expect((await db.asset.findUniqueOrThrow({ where: { id: choice.assetId } })).status).toBe(
      'available'
    );
  });
  it('rejects changed provider without leaving a signed artifact', async () => {
    await expect(
      signContract(
        db,
        { ...choice, participants: { ...participants, providerId: 'provider-pelto' } },
        '2026-11-05',
        lists,
        table
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_CHANGED' });
    expect(await db.contractDocument.count()).toBe(0);
  });
  it('does not reserve or sign anything when rendering the PDF fails', async () => {
    const failure = vi
      .spyOn(PDFDocument, 'create')
      .mockRejectedValueOnce(new Error('renderer unavailable'));
    await expect(
      signContract(db, { ...choice, participants }, '2026-11-05', lists, table)
    ).rejects.toThrow('renderer unavailable');
    failure.mockRestore();
    expect(await db.contract.count()).toBe(0);
    expect(await db.contractDocument.count()).toBe(0);
    expect((await db.asset.findUniqueOrThrow({ where: { id: choice.assetId } })).status).toBe(
      'available'
    );
  });
});

describe('profile tooling', () => {
  it('returns scoped incoming/outgoing data, summary and document metadata', async () => {
    const contract = await signContract(
      db,
      { ...choice, participants },
      '2026-11-05',
      lists,
      table
    );
    expect((await listParticipantContracts(db, 'cust-aino')).map((row) => row.id)).toEqual([
      contract.id,
    ]);
    expect(await listParticipantContracts(db, 'cust-mikko')).toEqual([]);
    const profile = await profileGet(request(), undefined);
    expect(await profile.json()).toMatchObject({
      success: true,
      data: {
        incoming: [{ id: contract.id }],
        outgoing: [],
        summary: { incoming: { active: 1, monthlyNetCents: 10730 } },
      },
    });
    expect(await (await profileGet(request('KETTU'), undefined)).json()).toMatchObject({
      data: { outgoing: [{ id: contract.id }], incoming: [] },
    });
    const context = { params: Promise.resolve({ id: contract.id }) };
    expect(await (await contractGet(request(), context)).json()).toMatchObject({
      data: { document: { locale: 'en', href: `/documents/contracts/${contract.id}` } },
    });
    expect((await contractGet(request('mikko'), context)).status).toBe(404);
    expect((await profileGet(new Request('http://localhost'), undefined)).status).toBe(401);
  });
  it('resolves an unknown sign-in name to a new participant with no leases', async () => {
    await signContract(db, { ...choice, participants }, '2026-11-05', lists, table);
    const reply = await (await profileGet(request('Somebody New'), undefined)).json();
    expect(reply).toMatchObject({
      data: { user: { displayName: 'Somebody New' }, incoming: [], outgoing: [] },
    });
    expect(
      await db.demoUser.findUnique({ where: { canonicalUsername: 'somebody new' } })
    ).toMatchObject({ id: reply.data.user.id });
  });
  it('seeds the same item owners as the dealer side', async () => {
    await seedDealerSide(db, await loadAssets());
    const [assets, ownership] = await Promise.all([
      db.asset.findMany({ select: { id: true, ownerId: true } }),
      db.assetOwnership.findMany(),
    ]);
    const dealerOwner = new Map(ownership.map((row) => [row.assetId, row.providerId]));
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) expect(asset.ownerId).toBe(dealerOwner.get(asset.id));
    expect(await db.demoUser.findUnique({ where: { canonicalUsername: 'kettu' } })).toMatchObject({
      id: 'provider-kettu',
    });
  });
  it('seed reruns do not change ownership or reattribute legacy contracts', async () => {
    expect(await seedDemoParticipants(db)).toEqual({ usersCreated: 0, assetsAssigned: 0 });
    const contract = await signContract(db, choice, '2026-11-05', lists, table);
    expect(contract.renterId).toBeNull();
    expect(await listParticipantContracts(db, 'cust-aino')).toEqual([]);
  });
});
