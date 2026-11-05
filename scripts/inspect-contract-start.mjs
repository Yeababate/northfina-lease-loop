// Read-only inspection; this command never migrates, resolves or repairs a database.
import Database from 'better-sqlite3';
import { pathToFileURL } from 'node:url';

export const START_MIGRATION = '20261105190012_contract_start_date';

export function inspectContractStartMigration(db) {
  const exists = (name) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const tables = {};
  for (const name of ['Contract', 'new_Contract', 'Invoice']) {
    if (exists(name))
      tables[name] = {
        columns: db
          .pragma(`table_info("${name}")`)
          .map(({ name, notnull }) => ({ name, required: !!notnull })),
        count: db.prepare(`SELECT count(*) AS count FROM "${name}"`).get().count,
      };
  }
  const migrations = exists('_prisma_migrations')
    ? db
        .prepare(
          'SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at'
        )
        .all()
    : [];
  const failed = migrations.some(
    (row) =>
      row.migration_name === START_MIGRATION &&
      row.finished_at === null &&
      row.rolled_back_at === null
  );
  return {
    tables,
    migrations,
    foreignKeyViolations: db.pragma('foreign_key_check'),
    recoveryRequired: failed || !!tables.new_Contract,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const filename = process.argv[2];
  if (!filename)
    throw new Error('Usage: node scripts/inspect-contract-start.mjs /absolute/path/to/database.db');
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    console.log(JSON.stringify(inspectContractStartMigration(db), null, 2));
  } finally {
    db.close();
  }
}
