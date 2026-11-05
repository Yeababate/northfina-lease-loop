# Long-term rental discounts (#8)

## Policy

A dealer selects the existing demo provider context and creates or edits rules for
that provider's inventory at `/{locale}/discounts`. The cookie is the repository's
mock provider switch, not authentication. Mutating endpoints require a valid
selected provider and cannot edit another provider's rules. The browser never
chooses which provider's rules price an asset: current `AssetOwnership` does.

Rules have an inclusive minimum/maximum duration, a name, an enabled flag and a
percentage stored as integer basis points (100 basis points = 1%). Allowed values
are 0.01–100%, with two decimal places of percentage precision.
Duration endpoints are whole months from 1 through 48, minimum no greater than
maximum, and the range must contain at least one available term (12/24/36/48).
The term slider still offers the coefficient table's supported terms.

When enabled ranges overlap, the greatest percentage wins. Equal percentages use
the lexically smallest rule ID, independent of database ordering. Rules do not
stack. There are no scheduled activation dates in this MVP: an enabled rule
applies to new quotes/signings immediately. Disable a rule to withdraw it.

Only the **monthly net rent** is discounted. First, the shared `quoteLease()`
calculates and rounds the original monthly rent exactly as before. The discount
is that integer rent multiplied by basis points and divided by 10,000, rounded
once to the nearest cent, half up. Final monthly rent is original minus discount,
with no independent second rounding. VAT is calculated on the discounted net
amount and rounded per invoice under the existing invoice-date VAT policy.

List price, down payment, financed amount, coefficient-band boundaries and the
optional buyout do not change. Net total is down payment plus the agreed number
of final monthly rents. A 100% rule makes rental payments zero; it does not remove
the down payment, financed-amount limits, optional buyout or eligibility checks.
A 50% discount on a 101-cent original rent rounds to 51 cents, leaving 50 cents.

## Shared pricing, consent and snapshots

The item-page sliders, term comparison, application and review page all load the
current asset owner's enabled rules and pass them to `quoteLease()`. The shared
calculation reports original rent, discount and final rent; these appear before
confirmation, including a zero-discount breakdown for ineligible terms.
`priceContract()` delegates to the same calculation. Eligibility is rerun on the
server using the discounted rent including start-date VAT and unchanged financed
amount. Provider ownership/history links and the return/refurbishment flow remain
in the signing transaction.

Signing rereads rules inside the audited contract transaction and checks the
displayed rent, buyout, list version, selected rule ID and rule revision. Any edit
to the selected rule increments its revision, even if cent rounding leaves the
rent unchanged. New, disabled or changed applicable promotions therefore require
a refresh/review before signing. Changes to losing, unrelated rules do not alter
the offer. Consent identities include the selected rule ID and revision.

Each contract stores the original monthly net rent, monthly discount cents,
percentage, selected rule ID/revision and resulting monthly net rent alongside
its existing immutable quote snapshot. There is no mutable relation from that
snapshot to a discount rule. Later changes never update existing contracts or
issued invoices, and new invoices use only the saved net rent and start date.

Existing contracts migrate with zero discount and null rule metadata; their
saved rents, buyouts and invoices are copied unchanged. Original rent is nullable
for those historical contracts rather than invented or recalculated. The UI uses
the saved net rent as the no-discount original in that case.

## Persistence and API

- `GET /api/discount-rules` lists only the selected provider's rules.
- `POST /api/discount-rules` accepts `{name, minTermMonths, maxTermMonths,
discountBps, enabled}` and creates revision 1.
- `PATCH /api/discount-rules/[id]` accepts `{rule: {...}, revision}`. Updates require
  both ownership and the current revision; stale edits return 409 and change
  nothing. Another provider sees 404.
- `POST /api/contracts` now accepts `expectedDiscountRuleId` and
  `expectedDiscountRuleRevision`. Omitted values mean an undiscounted offer;
  they cannot bypass an active discount's stale-offer protection.

Routes use shared response envelopes and safe errors. Rule create/update and
contract writes use `withAudit()` and its transaction client. No hard-delete API
is provided; disabled rules remain available for dealer review.

Prisma generated `20261105204134_long_term_discounts` from the schema change.
`npm run db:migrate -- --name long_term_discounts` applied it and the pending
teammate dealer migration locally, without a reset. No old migration SQL was
edited. A temporary populated-database test verifies the generated migration
preserves contracts, invoices, assets, original audits and dealer ownership links.
The legacy start-date reproduction test now deploys only migrations preceding
that failure before adding the failing migration, keeping its historical fixture
valid as newer migrations are added.

## Verification and manual steps

Tests cover inclusive duration boundaries, ineligible terms, disabled/overlapping
rules, deterministic ties, percentage/range validation, half-cent rounding, zero
and full discounts, quote/contract equality, dealer isolation, concurrent-edit
revisions, audit rollback, stale offers and existing-contract/invoice preservation.
Rendered-page tests verify matching original/discount/final values on the actual
calculator, application and review pages. Existing eligibility and Money Core
tests remain in the full suite.

To verify manually:

The existing provider/inventory seed is a prerequisite. If the dealer selector is
empty after applying the teammate's dealer migration, `npm run db:seed` adds
missing demo providers and ownership rows through the existing audited seed; its
implementation preserves existing asset changes. The provider-setup fix now runs it on the local database after taking a backup.
Every preexisting row was compared afterwards: 30 assets, 3 contracts and 108
invoices were unchanged. The first run added 3 providers, 30 ownership links and
6 return imports; the second added nothing and left every table unchanged. The
page explains the seed command and reload action when no profiles exist.

1. Open `/en/discounts`, select a seeded demo provider such as Kettu and create an
   enabled 10% rule covering 24–48 months. Edit it and verify the saved revision.
   Select another provider: the first dealer's rules must not appear.
2. Open a Kettu item in the catalogue, move the term/down-payment sliders and
   compare terms. Inspect original rent, discount and final net/gross amounts.
   A 12-month term must show no discount. Down payment and buyout stay unchanged.
3. Complete an eligible application. Review the same discounted price and agree
   before signing. An incomplete/declined application must remain blocked.
4. With the review page open, change the rule in another tab. Signing the old
   offer must return the refresh/review message; reload and explicitly agree.
5. Generate invoices on the signed contract, then edit/disable its rule. Reload
   the contract and regenerate: saved net amounts and invoice IDs must remain
   identical. VAT still follows each invoice date.
6. Repeat the renter flow with `fi`, `sv` and `et`. Provider selection and discount
   controls use the same translation keys in all four languages.

The available environment has no browser connector or installed browser, so
visual and interactive browser verification is not claimed.

### Completed verification

`npm run check:all` passes on Linux Node v22.22.1: 414 tests across 44 files,
98.85% line coverage, lint/type/format checks and the production build. Hooks
remain enabled at `.husky/_`. The tests include the actual populated-schema
migration and original dealer return-flow tests, including the existing required
buyout-confirmation field in that flow's signing fixture.

Production HTTP verification ran on port 3104 with a temporary SQLite backup,
then the server was stopped. It verified provider selection, missing-provider
401, dealer create/update, cross-provider 404, a 12-month ineligible quote, shared
original/discount/final amounts on the actual item/application/review routes,
eligibility rejection, stale revision 409 despite unchanged rent, and a signed
discounted contract. For the sampled laptop, original rent was 5,725 cents; a 10%
discount rounded from 572.5 to 573 cents, leaving 5,152 cents net.

The saved contract and 36 persisted invoices retained those amounts and IDs after
the dealer changed the percentage and disabled the rule. December/January invoice
VAT remained 25.5%/26%. All four language contract pages displayed the saved
discount and 36-row invoice list, and all four dealer pages rendered successfully.
The user's database fingerprint was recorded before HTTP verification and checked
afterwards; no smoke-test writes reached it. Temporary artifacts are under
`/tmp/lease-loop-discount-smoke-O7fPYZ`.

No database reset, old migration rewrite, commit, push or merge was performed.

### Provider setup follow-up

The seed now checks persisted asset status/category rather than overwriting or
reinterpreting stock from stale data-pack state. Existing provider names and
ownership links are preserved. Return imports use the existing owner when one is
already recorded; reserved stock is not imported as returned merely because the
data pack once marked it returned.

The selected provider and its current rules are read on the server from the
existing provider-session cookie. The creation/editing forms therefore render
immediately for that context rather than waiting for a separate initialization
fetch. An unknown provider cookie does not expose another dealer's rules.

The main introduction now asks users to choose a provider and create/save a rule.
Percentage limits, overlap policy and technical tie-breaking remain available in
the collapsed “How discounts work” section, in all four languages.

To repeat setup, run `npm run db:seed` (never `db:reset`), then refresh
`/en/discounts` and select **Kettu Mobility Oy**. Its demo inventory includes
laptops and most e-bikes; farm machines belong to **Pelto Agri Rental Oy**, and
`ebike-005` belongs to Aino. Create a 10% rule for 24–48 months and use an
available Kettu item with a 36-month term. Review original/discount/final amounts
in the sliders, application and signing page. Existing contracts retain their
saved net rent regardless of the new rule. Setup adds no discount rule itself.

The pre-setup backup and row snapshots are retained under
`/tmp/lease-loop-provider-setup-fORM1i`.

Provider-setup verification passed: `npm run check:all` ran 417 tests across 45
files, with 98.85% line coverage and a successful production build. The seed test
preserves customised provider names, transferred inventory ownership, current
asset status, contracts and invoices; a repeated seed changes no rows or audits.

HTTP verification on a temporary post-setup copy (port 3105, stopped afterwards)
selected Kettu through the existing provider-session API, rendered the creation
form, saved a 10% rule and rendered its editing form. The actual item slider,
application and review pages showed the same prices; signing and invoices used
the discounted net amount. Editing the rule left all 3 original contracts and
108 invoices, plus the new signed snapshot, unchanged. All four localized dealer
forms rendered. Browser clicking/visual checks remain unverified because this
environment has no browser access. Smoke-test rules and contracts were not added
to the user's database; only the requested provider/inventory seed was run there.

### Provider identity and list sources

All runtime provider names come from persisted `Provider` rows through
`listProviders()` in `src/server/providers.ts`. Both Dealer discounts and the
read-only `GET /api/providers` directory use this reader. Provider-session
selection uses `getProvider()` to look up the submitted **ID** in that same table.
`DEMO_PROVIDERS` remains seed-only bootstrap data, never a runtime directory or
an alternative name-matching source.

Inventory links use `AssetOwnership.providerId`; promotions use
`DiscountRule.providerId`. Pricing follows the asset's current ownership ID, not
the visitor's selected dealer context or any display name. An unresolved provider
link does not authorize promotions and is not silently repaired or reassigned.

Read-only inspection for the provider-name report found these existing identities:

| ID               | Stored display name  | Inventory items |
| ---------------- | -------------------- | --------------- |
| `provider-kettu` | Kettu Mobility Oy    | 21              |
| `provider-pelto` | Pelto Agri Rental Oy | 8               |
| `cust-aino`      | Aino Virtanen        | 1               |

The two existing discount rules linked to Pelto and Aino by those IDs. Their
user-entered rule labels are separate from provider display names. No duplicate
provider IDs, missing provider links or conflicting names were found in this
database. No provider names, rule labels, ownership links or other database rows
were changed in response to this report; no seed was rerun.

No separate provider-list UI was found in this checkout or current upstream main.
The URL/backing endpoint of the other reported list is still needed to trace and
reconcile that particular view; records must not be merged or renamed based on
similar labels. Any such view should consume the shared provider directory.

Regression tests use two existing providers with identical display names to prove
ID-based selection and discount isolation, verify a renamed display name updates
the directory without relinking rules or stock, compare the selector to the list
API, and preserve unresolved records without applying their discounts. The full
check passes with 421 tests and a production build.

Read-only HTTP verification on port 3106 compared `/api/providers` to the actual
database and the rendered selector for each of the three existing provider IDs.
All names/IDs matched, selected-provider sessions returned the same ID, and each
discount list contained only that provider's rules. The server was stopped after
verification; the source database fingerprint was unchanged. The separate
reported provider-list view still needs its URL to trace its backing source.
