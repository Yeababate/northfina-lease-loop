import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { inspectContractStartMigration, START_MIGRATION } from './inspect-contract-start.mjs';
import { planLegacyContractStart } from '../src/domain/legacy-contract-start';

import { restoreLegacyMoneySnapshot } from '../src/server/legacy-money-recovery';
import { createTestDb } from '../tests/helpers/test-db';

const require = createRequire(import.meta.url);
const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build/index.js');
let directory;
let filename;
let config;
let snapshot;
let failure;

function deploy(configFile = config, databaseFile = filename) {
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', configFile], {
      env: { ...process.env, DATABASE_URL: `file:${databaseFile}` },
      stdio: 'pipe',
    });
    return '';
  } catch (error) {
    return String(error.stdout) + String(error.stderr);
  }
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'lease-loop-legacy-'));
  filename = path.join(directory, 'legacy.db');
  config = path.join(directory, 'prisma.config.ts');
  const migrations = path.join(directory, 'migrations');
  await mkdir(migrations);
  const source = path.resolve('prisma/migrations');
  for (const entry of await readdir(source)) {
    if (entry === 'migration_lock.toml' || entry < START_MIGRATION)
      await cp(path.join(source, entry), path.join(migrations, entry), { recursive: true });
  }
  await writeFile(
    config,
    `export default ${JSON.stringify({
      schema: path.resolve('prisma/schema.prisma'),
      migrations: { path: migrations },
      datasource: { url: `file:${filename}` },
    })};`
  );
  expect(deploy()).toBe('');
  const db = new Database(filename);
  const contract = {
    id: 'legacy-1',
    actor: 'Legacy renter',
    assetId: 'ebike-003',
    signedOn: '2026-01-31',
    endOn: '2029-01-31',
    termMonths: 36,
    downPaymentCents: 0,
    listPriceCents: 389000,
    priceListVersion: 1,
    coefficientVersion: 1,
    coefficientId: 'ct-2026-1',
    band: 'B',
    factor: 0.027584,
    financedCents: 389000,
    monthlyNetCents: 10730,
    buyoutNetCents: 58350,
  };
  const asset = JSON.parse(await readFile('data/assets.json', 'utf8')).find(
    (row) => row.id === contract.assetId
  );
  const { usage, ...assetFields } = asset;
  const assetRow = {
    created_at: '2026-01-31T00:00:00.000Z',
    updated_at: '2026-01-31T00:00:00.000Z',
    ...assetFields,
    usage_unit: usage.unit,
    usage_value: usage.value,
    status: 'reserved',
  };
  const assetColumns = Object.keys(assetRow);
  db.prepare(
    `INSERT INTO Asset (${assetColumns.join(',')}) VALUES (${assetColumns.map(() => '?').join(',')})`
  ).run(...Object.values(assetRow));
  db.prepare(
    'INSERT INTO AuditLog (actor,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?)'
  ).run('Legacy renter', 'contract.signed', 'contract', contract.id, JSON.stringify(contract));
  const columns = Object.keys(contract);
  db.prepare(
    `INSERT INTO Contract (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
  ).run(...Object.values(contract));
  db.prepare(
    'INSERT INTO Invoice (id,contractId,period,invoiceDate,dueDate,netCents,vatPercent,vatCents,grossCents) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run('legacy-invoice', 'legacy-1', 1, '2026-01-31', '2026-01-31', 10730, 25.5, 2736, 13466);
  snapshot = {
    assets: db.prepare('SELECT * FROM Asset').all(),
    audits: db.prepare('SELECT * FROM AuditLog').all(),
    contracts: db.prepare('SELECT * FROM Contract').all(),
    invoices: db.prepare('SELECT * FROM Invoice').all(),
  };
  db.close();
  await cp(path.join(source, START_MIGRATION), path.join(migrations, START_MIGRATION), {
    recursive: true,
  });
  failure = deploy();
}, 30000);
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('reproduces P3018 on legacy rows and inspects the actual partial state without repair', () => {
  expect(failure).toContain('P3018');
  expect(failure).toContain('NOT NULL constraint failed: new_Contract.startOn');
  const db = new Database(filename, { readonly: true });
  try {
    const state = inspectContractStartMigration(db);
    expect(state.recoveryRequired).toBe(true);
    expect(state.tables.Contract.count).toBe(1);
    expect(state.tables.Contract.columns.some((column) => column.name === 'startOn')).toBe(false);
    expect(state.tables.new_Contract.count).toBe(0);
    expect(state.tables.Invoice.count).toBe(1);
    expect(state.migrations.find((row) => row.migration_name === START_MIGRATION)).toMatchObject({
      finished_at: null,
      rolled_back_at: null,
      applied_steps_count: 0,
    });
    expect(state.foreignKeyViolations).toEqual([]);
    expect(db.prepare('SELECT * FROM Contract').all()).toEqual(snapshot.contracts);
    expect(db.prepare('SELECT * FROM Invoice').all()).toEqual(snapshot.invoices);
    expect(inspectContractStartMigration(db)).toEqual(state);
    expect(() => db.prepare('DELETE FROM Contract').run()).toThrow();
  } finally {
    db.close();
  }
});

it('prepares a compatible start-date backfill from original-policy evidence without applying it', () => {
  const before = structuredClone(snapshot);
  const plan = planLegacyContractStart({
    ...snapshot.contracts[0],
    provenance: 'original-signing-day-policy',
    invoices: snapshot.invoices,
  });
  expect(plan).toEqual({ ok: true, startOn: '2026-01-31', source: 'legacy_signing_policy' });
  expect(
    planLegacyContractStart({
      ...snapshot.contracts[0],
      provenance: 'unknown',
      invoices: snapshot.invoices,
    })
  ).toMatchObject({ ok: false, reason: 'unknown_start' });
  expect(snapshot).toEqual(before);
});

it('shows that appending another migration cannot get past the failed migration', () => {
  expect(deploy()).toContain('P3009');
  const db = new Database(filename, { readonly: true });
  try {
    expect(db.prepare('SELECT * FROM Contract').all()).toEqual(snapshot.contracts);
    expect(db.prepare('SELECT * FROM Invoice').all()).toEqual(snapshot.invoices);
  } finally {
    db.close();
  }
});

function exportSnapshot() {
  return {
    ...structuredClone(snapshot),
    assets: snapshot.assets.map((row) => ({
      ...row,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    })),
    audits: snapshot.audits.map((row) => ({ ...row, created_at: new Date(row.created_at) })),
  };
}

it('recovers to a separately migrated empty database, preserving money, ids, assets and audits', async () => {
  const target = await createTestDb();
  try {
    const exported = exportSnapshot();
    expect(
      await restoreLegacyMoneySnapshot(target.db, exported, ['legacy-1'], 'recovery-test')
    ).toEqual({ contracts: 1, invoices: 1 });
    expect(await target.db.contract.findMany()).toMatchObject([
      { ...snapshot.contracts[0], startOn: '2026-01-31' },
    ]);
    expect(await target.db.invoice.findMany()).toEqual(snapshot.invoices);
    expect(await target.db.asset.findMany()).toEqual(
      exported.assets.map((asset) => ({ ...asset, ownerId: null }))
    );
    expect(await target.db.auditLog.findUnique({ where: { id: exported.audits[0].id } })).toEqual(
      exported.audits[0]
    );
    expect(await target.db.auditLog.count()).toBe(snapshot.audits.length + 1);
    expect(await target.db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    await expect(
      restoreLegacyMoneySnapshot(target.db, exported, ['legacy-1'], 'recovery-test')
    ).rejects.toThrow('Recovery target must be empty');
    expect(await target.db.invoice.count()).toBe(1);
    const source = new Database(filename, { readonly: true });
    try {
      expect(source.prepare('SELECT * FROM Contract').all()).toEqual(snapshot.contracts);
      expect(source.prepare('SELECT * FROM Invoice').all()).toEqual(snapshot.invoices);
      expect(inspectContractStartMigration(source).recoveryRequired).toBe(true);
    } finally {
      source.close();
    }
  } finally {
    await target.cleanup();
  }
});

it('refuses unknown legacy starts and rolls back the import if its audit cannot be written', async () => {
  const target = await createTestDb();
  try {
    await expect(
      restoreLegacyMoneySnapshot(target.db, exportSnapshot(), [], 'recovery-test')
    ).rejects.toThrow('unknown_start');
    expect(await target.db.contract.count()).toBe(0);
    const failing = target.db.$extends({
      query: {
        auditLog: {
          create() {
            throw new Error('audit unavailable');
          },
        },
      },
    });
    await expect(
      restoreLegacyMoneySnapshot(failing, exportSnapshot(), ['legacy-1'], 'recovery-test')
    ).rejects.toThrow('audit unavailable');
    expect(await target.db.contract.count()).toBe(0);
    expect(await target.db.invoice.count()).toBe(0);
    expect(await target.db.asset.count()).toBe(0);
    expect(await target.db.auditLog.count()).toBe(0);
  } finally {
    await target.cleanup();
  }
});

it('preserves populated contracts and invoices through discount and schema reconciliation migrations', async () => {
  const migrations = path.join(directory, 'discount-upgrade-migrations');
  await mkdir(migrations);
  const migration = '20261105204134_long_term_discounts';
  const source = path.resolve('prisma/migrations');
  for (const entry of await readdir(source)) {
    if (entry === 'migration_lock.toml' || entry < migration)
      await cp(path.join(source, entry), path.join(migrations, entry), { recursive: true });
  }
  const targetFile = path.join(directory, 'discount-upgrade.db');
  const targetConfig = path.join(directory, 'discount-upgrade.config.ts');
  await writeFile(
    targetConfig,
    `export default ${JSON.stringify({
      schema: path.resolve('prisma/schema.prisma'),
      migrations: { path: migrations },
      datasource: { url: `file:${targetFile}` },
    })};`
  );
  expect(deploy(targetConfig, targetFile)).toBe('');
  const sourceDb = new Database(targetFile);
  function insert(table, row) {
    const columns = Object.keys(row);
    sourceDb
      .prepare(
        `INSERT INTO "${table}" (${columns.map((key) => '"' + key + '"').join(',')}) VALUES (${columns.map(() => '?').join(',')})`
      )
      .run(...Object.values(row));
  }
  insert('Asset', snapshot.assets[0]);
  const legacy = { ...snapshot.contracts[0], startOn: snapshot.contracts[0].signedOn };
  insert('Contract', legacy);
  insert('Invoice', snapshot.invoices[0]);
  insert('AuditLog', snapshot.audits[0]);
  insert('Provider', { id: 'legacy-provider', displayName: 'Legacy dealer' });
  insert('AssetOwnership', {
    assetId: legacy.assetId,
    providerId: 'legacy-provider',
    source: 'seed',
  });
  insert('ContractProvider', {
    contractId: legacy.id,
    assetId: legacy.assetId,
    providerId: 'legacy-provider',
  });
  const preserved = Object.fromEntries(
    ['Asset', 'Invoice', 'AuditLog', 'Provider', 'AssetOwnership', 'ContractProvider'].map(
      (table) => [table, sourceDb.prepare(`SELECT * FROM "${table}"`).all()]
    )
  );
  sourceDb.close();
  for (const entry of await readdir(source)) {
    if (entry !== 'migration_lock.toml' && entry >= migration)
      await cp(path.join(source, entry), path.join(migrations, entry), { recursive: true });
  }
  expect(deploy(targetConfig, targetFile)).toBe('');
  const upgraded = new Database(targetFile, { readonly: true });
  try {
    expect(upgraded.prepare('SELECT * FROM Contract').all()).toEqual([
      {
        ...legacy,
        originalMonthlyNetCents: null,
        monthlyDiscountCents: 0,
        discountBps: 0,
        discountRuleId: null,
        discountRuleRevision: null,
        providerId: null,
        renterId: null,
      },
    ]);
    for (const [table, rows] of Object.entries(preserved))
      expect(upgraded.prepare(`SELECT * FROM "${table}"`).all()).toEqual(rows);
    expect(upgraded.pragma('foreign_key_check')).toEqual([]);
    expect(
      upgraded
        .prepare('SELECT finished_at FROM _prisma_migrations WHERE migration_name=?')
        .get(migration).finished_at
    ).not.toBeNull();
  } finally {
    upgraded.close();
  }
}, 30000);
