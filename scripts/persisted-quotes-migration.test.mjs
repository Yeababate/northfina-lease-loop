import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build/index.js');
const quoteMigration = '20261106081927_persist_quotes';
let directory;
let filename;
let config;
let before;

function deploy() {
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', config], {
      env: { ...process.env, DATABASE_URL: `file:${filename}` },
      stdio: 'pipe',
    });
    return '';
  } catch (error) {
    return String(error.stdout) + String(error.stderr);
  }
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'lease-loop-quotes-migration-'));
  filename = path.join(directory, 'legacy.db');
  config = path.join(directory, 'prisma.config.ts');
  const migrations = path.join(directory, 'migrations');
  await mkdir(migrations);
  const source = path.resolve('prisma/migrations');
  for (const entry of await readdir(source)) {
    if (entry === 'migration_lock.toml' || entry < quoteMigration)
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
  db.prepare(
    'INSERT INTO Contract (id,actor,renterId,providerId,assetId,startOn,endOn,signedOn,termMonths,downPaymentCents,listPriceCents,priceListVersion,priceSource,coefficientVersion,coefficientId,band,factor,financedCents,monthlyNetCents,buyoutNetCents,originalMonthlyNetCents,monthlyDiscountCents,discountBps,discountRuleId,discountRuleRevision,signatoryEmail,signatorySignedOn) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    'legacy-contract',
    'Aino Virtanen',
    'cust-aino',
    'provider-kettu',
    'laptop-004',
    '2026-01-31',
    '2027-01-31',
    '2026-01-31',
    12,
    1000,
    250000,
    1,
    'price_list',
    1,
    'coefficients-v1',
    'laptop-small',
    0.03,
    249000,
    7470,
    49800,
    7470,
    0,
    0,
    null,
    null,
    null,
    null
  );
  db.prepare(
    'INSERT INTO Invoice (id,contractId,period,invoiceDate,dueDate,netCents,vatPercent,vatCents,grossCents) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run('legacy-invoice', 'legacy-contract', 1, '2026-01-31', '2026-01-31', 7470, 25.5, 1905, 9375);
  before = {
    contract: db.prepare('SELECT * FROM Contract WHERE id=?').get('legacy-contract'),
    invoice: db.prepare('SELECT * FROM Invoice WHERE id=?').get('legacy-invoice'),
  };
  db.close();

  await cp(path.join(source, quoteMigration), path.join(migrations, quoteMigration), {
    recursive: true,
  });
}, 30000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('adds quote metadata while preserving a legacy contract, its invoice and foreign keys', () => {
  expect(deploy()).toBe('');
  const db = new Database(filename, { readonly: true });
  try {
    const contract = db.prepare('SELECT * FROM Contract WHERE id=?').get('legacy-contract');
    const invoice = db.prepare('SELECT * FROM Invoice WHERE id=?').get('legacy-invoice');
    expect(contract).toMatchObject({
      id: before.contract.id,
      monthlyNetCents: before.contract.monthlyNetCents,
      buyoutNetCents: before.contract.buyoutNetCents,
      priceListVersion: before.contract.priceListVersion,
      quoteId: null,
      quotedPriceListVersion: null,
      lockedPriceListVersion: null,
    });
    expect(invoice).toEqual(before.invoice);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(
      db
        .prepare('SELECT finished_at FROM _prisma_migrations WHERE migration_name=?')
        .get(quoteMigration).finished_at
    ).not.toBeNull();
  } finally {
    db.close();
  }
}, 30000);
