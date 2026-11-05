# src/domain: the business rules

This folder holds the rules of Lease Loop as plain functions. Most of your
hackathon work belongs here.

## Rules for this folder

1. **Pure.** No database, no files, no network, no `process.env`, no framework imports.
   A function gets everything it needs as arguments and returns a value.
2. **Deterministic.** No `Date.now()`, `new Date()` or `Math.random()`. Dates come in as
   ISO strings (`YYYY-MM-DD`) chosen by the caller. The same input always gives the same output.
3. **Money is integer cents.** `189900` means 1 899,00 €. Do not use floats for money, and
   decide on purpose where you round (and say so in a comment).
4. **Expected failures are values, not exceptions.** "This amount cannot be financed" is an
   answer the UI must show, so return a result such as
   `{ ok: false, reason: 'below_minimum' }`. Throw only for bugs (for example, a fraction of
   a cent).
5. **Every function has tests.** Put them next to the code (`pricing.ts` → `pricing.test.ts`)
   and test the edges: band limits, the first and last day of a date range, zero, empty lists.

ESLint enforces rules 1 and 2 for this folder (see `eslint.config.mjs`).

## What is here

| File                     | What it does                                                             |
| ------------------------ | ------------------------------------------------------------------------ |
| `coefficient.ts`         | Worked example: finds the monthly factor for a financed amount and term. |
| `price-list.ts`          | Worked example: finds the net list price of an asset on a date.          |
| `money.ts`               | Formats cents as euros for a locale. Use it only in the UI.              |
| `rounding.ts`            | The one rounding rule: integer maths, rounded once, half up.             |
| `vat.ts`                 | VAT rate on a date, the next rate change, VAT on a net amount.           |
| `pricing.ts`             | Monthly rent, VAT, buyout and total for a term and down payment.         |
| `catalogue.ts`           | Catalogue filters and sorting, read safely from the URL; badges.         |
| `iso-date.ts`            | Checks ISO dates and works out an age on a given day.                    |
| `business-id.ts`         | Checks a Finnish business ID (Y-tunnus) and its check digit.             |
| `answer-check.ts`        | Checks one application answer against its question type.                 |
| `question-flow.ts`       | Picks the next question and drops answers that stop applying.            |
| `eligibility.ts`         | Approved, declined or manual review, with the checks behind it.          |
| `refurbishment-rules.ts` | Required work for a returned item, from the data-pack rules (no costs).  |
| `next-life.ts`           | Returned item state machine: receipt, inspection, work, guarded relist.  |

### How the question flow works

1. The UI keeps the customer's answers and calls `resolveFlow(questions, deal, answers)`
   after every change, including going back and changing an earlier answer.
2. It shows `next.question` (with `next.problem` as an inline error, for example a wrong
   business ID check digit), stores `answers` in place of its own, and shows a notice
   listing `removed` when answers were dropped because their question no longer applies.
3. `status: 'blocked'` means an answer stops the application (under 18, a country we do
   not lease to): no more questions are asked.
4. When `status` is `complete` or `blocked`, `decideApplication()` gives the outcome, the
   `reasons` for it and every `check`. It needs the monthly rent with VAT from pricing.

## What teams are expected to add

Create these as you need them. Do not commit empty files.

- `pricing`: monthly rent, down payment, VAT and the end-of-term buyout price.
- `question-flow`: which question to ask next, from `data/questions.json`, and what happens
  to answers that stop applying.
- `contract`: build the contract from an approved application and lock it so it cannot change.
- `invoicing`: the monthly invoices for a contract, including a VAT rate change mid-contract.
- `end-of-term`: return, buy out or extend, and the value of the returned item.
- `second-life`: refurbishment cost, matching a returned item to the waiting list, CO2 saved.

## Contract price lock

`contract-pricing.ts` selects the signing-date list and builds the snapshot using
`quoteLease()` from `pricing.ts`, the same calculation used by the sliders.
Contract pricing tests live alongside the unchanged quote tests.

Signing locks the net price from the catalogue valid on the signing date, rather
than preserving an earlier quote. If the displayed quote has become stale, the
signing API rejects it so the renter can refresh and review before consenting.
The stored contract includes the list price and version, coefficient identity and
version, band, factor, down payment, financed amount, monthly net rent, buyout,
signing date and term. Later catalogue or coefficient edits do not modify it.

The locked period starts on the saved customer-selected `startOn` (on or after
signing) and ends at the exclusive monthly anniversary
stored as `endOn`. Short months clamp to their last day. Each monthly net rent and
the buyout are rounded once to nearest whole euro cent, with half cents rounded up.
The net rental total is monthly net rent multiplied by the agreed number of months;
the down payment and optional buyout are separate amounts.

VAT is not locked. `invoicePrice` takes the stored monthly net rent and selects the
VAT rate by invoice date (inclusive validity boundaries), rounding tax once per
invoice to the nearest cent, half up. The contract page lets the renter compare
invoice dates; this date comparison previews tax only. The separate invoice list shows persisted invoices.

Signing uses `withAudit` to create the contract and reserve the available item in
one transaction. The public API reruns application eligibility and derives the
signer from approved answers. The name alone cannot authorise signing; customer
authentication remains outside this MVP.

## Monthly invoices

`invoices.ts` schedules exactly `termMonths` full rental invoices in advance.
The first invoice date and payment due date are the saved lease start date
(`startOn`), which may be later than signing. For a mid-month
start, the first period runs from that day to the next monthly anniversary: there
is no calendar-month proration or extra stub-period charge. Invoice date and due
date are deliberately identical; no additional payment grace period is assumed.

Each date is calculated from the original lease start day with `contractEndOn`,
clamping independently to the last day of each shorter month. A 31 January 2026
start bills on 28 February 2026, 31 March 2026 and 29 February 2028. The final
invoice precedes the exclusive contract end date.

Every net amount is the saved contract's locked monthly net rent, already rounded
at signing. The net rental total is exactly rent × term. Down payment and optional
buyout are separate, excluded from rental invoices. VAT is selected using each
invoice date and rounded once per invoice to whole cents, half up; gross totals
sum those individual net and tax lines, never an independently rounded total.

The contract page's explicit generation button issues the entire schedule,
including future dated invoices, using the VAT table known at generation time.
Issued invoice amounts are immutable snapshots; future statutory changes would
need an explicit adjustment workflow outside this MVP. GET never issues invoices.
POST /api/contracts/[id]/invoices accepts a caller-supplied actor, matching the
starter's audit convention; it is not an authentication mechanism.
Generation uses one audited transaction and a database unique key on contract and
period. Retries return the same invoices; the audit records each successful
generation request, including retries. Missing VAT fails the whole generation.

See [Money Core verification and legacy recovery](../../docs/money-core-integration.md)
for start-date evidence, migration failure reproduction and the tested side-by-side
recovery approach.

## Long-term discounts

`discounts.ts` validates dealer rule inputs and selects the greatest eligible
percentage (ties use the smallest rule ID; rules never stack). The shared
`quoteLease()` calculates original rent, discount and final rent in integer cents.
Only monthly net rent is discounted; down payment, financed amount and buyout are
unchanged. Signing snapshots the applied rule revision and values; invoices never
read mutable discount rules. See [policy, rounding and verification](../../docs/long-term-discounts.md).
