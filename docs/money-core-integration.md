# Money Core integration and legacy recovery (#27)

## Scope and environment

Work started from a clean `fix/27-money-core-integration` checkout on Linux with
Node v22.22.1. Hooks remain configured at `.husky/_`. No application database was
reset, seeded, migrated or repaired during this investigation. Migration files
and their checksums are unchanged.

The calculator and sliders still use `quoteLease()`. Application pricing uses
that same function and signing delegates to it through `priceContract()`, selecting
the signing-day list. The public signing API recomputes eligibility from answers;
a supplied actor or browser-side approval cannot bypass the application.

Signing now requires the displayed buyout as well as monthly net rent and list
version. A change to any of those returns `PRICE_CHANGED` before reservation or
contract writes. Consent belongs to the precise displayed offer, including the
start date and VAT preview. A changed offer clears consent; a rejected stale offer
must be reloaded, reviewed and confirmed again. Missing answers, unapproved
applications, signatory restrictions and loading still prevent signing.

The saved `startOn` anchors billing. Price locks on `signedOn`; a lease may start
later. Exactly `termMonths` full rental invoices are dated/due from that start,
with no mid-month proration or extra stub charge. Each anniversary is calculated
from the original day, recovering the 31st after February. VAT is selected by
invoice date and rounded per invoice in integer cents. Down payment and optional
buyout remain separate. Issued rows are immutable and uniquely keyed by contract
and period; generation and its audit commit together.

## What was observed in the local database

Read-only inspection found all four migrations marked finished, one contract,
36 invoices, no `new_Contract` table and no foreign-key violations. Thus this
checkout's current database does **not** have the earlier failed migration state.
It is not evidence that the migration is safe for legacy populated databases.

Use this read-only inspector against an explicit SQLite file:

```sh
node scripts/inspect-contract-start.mjs /absolute/path/to/database.db
```

It reports table columns/counts, migration completion/rollback metadata and
foreign-key violations. It never modifies the database or migration ledger.
Do not run `db:setup`, `db:reset`, `migrate reset` or `migrate resolve` to inspect.

## Reproduced failure and actual partial state

`scripts/contract-start-recovery.test.mjs` creates an isolated database by deploying
the repository's unchanged migrations up to the one before
`20261105190012_contract_start_date`. It inserts a representative legacy contract,
an issued invoice, its reserved asset and audit history. It then deploys the
unchanged start-date migration with Prisma.

Prisma reports P3018, `NOT NULL constraint failed: new_Contract.startOn`. The
generated INSERT copies the old columns but omits the new required `startOn`.
The observed state after failure is:

- Original `Contract`, `Invoice`, asset and audit rows remain intact.
- Empty `new_Contract` exists with the new required column.
- The migration row has no `finished_at`, no `rolled_back_at` and zero applied
  steps. Do not interpret the zero count as proof that no DDL ran.
- Foreign keys remain consistent. Re-running deploy reports P3009.

Every recovery must inspect its own state. A nonempty temporary table, missing
original table, conflicting rows, unknown provenance or foreign-key violations
require manual investigation; do not apply the observed empty-table assumptions.

## Date evidence and backfill policy

`planLegacyContractStart()` is a pure dry-run planner. A known, valid `startOn` is
preserved. Without one, `signedOn` is proposed **only** when the operator has
verified that the contract originated under the original signing-day-start policy
(release/audit evidence), the stored end date equals that start plus the agreed
term, and every issued invoice's date and unique period match that schedule.
The period bounds are checked. Agreement of end dates alone is not provenance.

Unknown or contradictory records block the entire import. Obtain their original
agreement/start-date evidence; do not substitute today's date, a guessed month
start or an arbitrary default. Net rent, buyout, coefficient and catalogue
snapshots, end dates and issued invoice amounts are never recalculated.

## Data-preserving side-by-side approach (tested, no history exception)

1. Stop application writes for a consistent recovery window. Take a SQLite online
   backup (including WAL contents), retain the original file, and record a source
   checksum plus row counts and money totals. Inspect the backup read-only.
2. Review a manifest of every contract's start-date evidence. Export the original
   assets, audit rows, contracts and invoices. Convert SQLite timestamp values to
   `Date` values with explicit UTC semantics; preserve their instants and IDs.
   The planner must approve every contract before importing anything.
3. Create a **different, empty** target SQLite file. Deploy the **unchanged**
   repository migrations with Prisma to that target, not the original file:

   ```sh
   DATABASE_URL=file:/absolute/path/to/new-target.db npx prisma migrate deploy
   ```

   Do not run the seed command. The new migration ledger truthfully records real,
   successful execution on the empty target; no failed migration is marked applied.

4. Use `restoreLegacyMoneySnapshot(targetClient, snapshot, verifiedOriginalPolicyIds,
recoveryActor)` from `src/server/legacy-money-recovery.ts`. It refuses an occupied
   target and imports all four sets through the `withAudit()` transaction client,
   preserving existing audit history and adding a recovery audit entry. Audit
   failure rolls back the whole import. This is an offline helper, not a public API
   or an automatically invoked startup task. Do not connect it to the source client.
5. Compare every source/destination contract and invoice, asset status, original
   audit row, ID and timestamp; the only contract addition is the evidenced
   `startOn`. Verify counts, net/VAT/gross totals, foreign keys and migration
   checksums. Repeated invoice generation must return the existing rows unchanged.
   Run the end-to-end application against the target and retain the manifest and
   source backup. Only then propose a separately reviewed database URL cutover.
   No cutover was performed here.

The tests exercise the failure, read-only inspection, blocked redeploy, evidenced
planning, a successful import into a separate fully migrated temporary database,
protection against occupied targets/unknown starts, source preservation and
audit-failure rollback. This preserves records without repairing the original
file in place and without rewriting migrations.

## Why an in-place migration repair is not included

A later generated migration cannot run past P3009. Making `startOn` nullable in a
new schema/migration cannot fix the already-earlier failing INSERT. Prisma schema
defaults cannot express the required per-row `startOn = signedOn` backfill.
Editing the old generated SQL would violate both the no-handwritten-SQL rule in
`AGENTS.md` and the instruction not to rewrite applied migrations.

If an in-place repair is required instead of the side-by-side approach, the
concrete proposed exception is an operator-reviewed, one-off data-copy/backfill
and table-swap repair, outside migration files, based on the verified per-contract
manifest. It must preserve all fields, indexes and invoice references, address the
actually observed partial state, and pass row-by-row, totals and foreign-key
checks against a backup. That requires an explicit exception for handwritten
repair SQL. Only after the **entire** original migration's intended schema and
verified data are complete could an operator consider recording it as completed;
an incomplete migration must never be marked applied. No such repair SQL, history
change or `resolve` command was created or executed here.

## Verification

- API integration exercises the calculator inputs, approval, signed snapshot,
  saved start date, invoice list and repeat generation. It checks February 2026,
  leap-year February 2028, day-anchor recovery, December/January VAT and cent totals.
- Regressions reject incomplete/declined applications, stale list prices and a
  changed buyout with unchanged rent/list version. Consent identities change for
  each displayed offer field, including gross preview.
- Existing tests continue to cover manual review, authorised signatories, audit
  rollback and duplicate/concurrent invoice generation.
- No browser connector, browser executable or Playwright installation is available
  in this session. Browser clicks and a visual review are therefore not claimed.
  Running-app HTTP checks are recorded below.

### Completed checks

`npm run check:all` passed on Linux Node v22.22.1: 38 files, 354 tests,
98.64% line coverage, lint/type/format checks and the production build.

The production build was started on localhost port 3103 using a temporary SQLite
online backup, then stopped after verification. HTTP checks verified:

- Catalogue and item sliders render, and term/down/start choices reach application
  and signing routes. The demo-name proxy still redirects unnamed visitors; the
  normal demo-name cookie allows the application/review pages to render.
- The signing page renders its loading-answers explanation. Client hydration,
  checkbox clicks and the visual layout remain unverified without a browser.
- Empty answers receive 422, a changed expected buyout receives 409, and a complete
  eligible application receives 201 with exactly the shared quote's rent/buyout.
- A 24-month laptop lease with a 10,000-cent down payment and saved 31 December
  2026 start produces 24 persisted invoices. December uses 25.5% VAT, January uses
  26%; February 2027 clamps to the 28th, March returns to the 31st and February 2028
  uses the 29th. Net invoices plus down payment equal the preview's net total;
  each gross amount equals net plus its individually rounded VAT.
- Concurrent repeat generation returns identical IDs/amounts. All four language
  contract pages render the translated 24-row persisted invoice table.

The source database SHA256 matched before and after the HTTP exercise; it still
contains one contract and 36 invoices. No source writes, migration/history repair,
database cutover, commit, push or merge were performed. The temporary HTTP backup
and saved rendered pages were left under `/tmp/lease-loop-money-core-http-uX9NHd`
for inspection; test-created legacy/recovery databases were cleaned up.
