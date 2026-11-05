import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { loadAssets, loadCoefficientTable, loadPriceLists } from '@/data/load';
import { getT } from '@/i18n/get-t';
import { createTestDb } from '../../tests/helpers/test-db';
import { GET as profileGet } from '@/app/api/profile/route';
import { GET as contractGet } from '@/app/api/contracts/[id]/route';
import { GET as documentGet } from '@/app/documents/contracts/[id]/route';
import { POST as login, DELETE as logout } from '@/app/api/demo-session/route';
import { seedAssets } from './assets';
import { seedDemoParticipants } from './demo-participants';
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
  expectedPriceListVersion: 1,
};
const participants = {
  renterId: 'cust-aino',
  providerId: 'provider-north',
  providerName: 'Loop North',
  locale: 'en' as const,
};
const request = (user = 'cust-aino') =>
  new Request('http://localhost/api/profile', { headers: { cookie: `lease-loop-user=${user}` } });
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
      expect((await getParticipantDocument(db, 'provider-north', contract.id)).bytes).toEqual(
        original.bytes
      );
      const reply = await documentGet(request('provider-north'), {
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
      (await documentGet(request('cust-mikko'), { params: Promise.resolve({ id: contract.id }) }))
        .status
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
        { ...choice, participants: { ...participants, providerId: 'provider-south' } },
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
    expect(await (await profileGet(request('provider-north'), undefined)).json()).toMatchObject({
      data: { outgoing: [{ id: contract.id }], incoming: [] },
    });
    const context = { params: Promise.resolve({ id: contract.id }) };
    expect(await (await contractGet(request(), context)).json()).toMatchObject({
      data: { document: { locale: 'en', href: `/documents/contracts/${contract.id}` } },
    });
    expect((await contractGet(request('cust-mikko'), context)).status).toBe(404);
    expect((await profileGet(new Request('http://localhost'), undefined)).status).toBe(401);
  });
  it('provides mock selection/switch/logout with HttpOnly session cookie and stable IDs', async () => {
    const post = (username: string) =>
      new Request('http://localhost/api/demo-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
    const first = await login(post('aino'), undefined);
    expect(first.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(await first.json()).toMatchObject({ data: { id: 'cust-aino' } });
    expect(await (await login(post(' AINO '), undefined)).json()).toMatchObject({
      data: { id: 'cust-aino' },
    });
    expect((await login(post(' '), undefined)).status).toBe(422);
    expect(
      (await logout(new Request('http://localhost'), undefined)).headers.get('Set-Cookie')
    ).toContain('Max-Age=0');
  });
  it('seed reruns do not change ownership or reattribute legacy contracts', async () => {
    expect(await seedDemoParticipants(db)).toEqual({ usersCreated: 0, assetsAssigned: 0 });
    const contract = await signContract(db, choice, '2026-11-05', lists, table);
    expect(contract.renterId).toBeNull();
    expect(await listParticipantContracts(db, 'cust-aino')).toEqual([]);
  });
});
