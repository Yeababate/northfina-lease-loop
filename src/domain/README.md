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

| File               | What it does                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| `coefficient.ts`   | Worked example: finds the monthly factor for a financed amount and term. |
| `price-list.ts`    | Worked example: finds the net list price of an asset on a date.          |
| `money.ts`         | Formats cents as euros for a locale. Use it only in the UI.              |
| `rounding.ts`      | The one rounding rule: integer maths, rounded once, half up.             |
| `vat.ts`           | VAT rate on a date, the next rate change, VAT on a net amount.           |
| `pricing.ts`       | Monthly rent, VAT, buyout and total for a term and down payment.         |
| `catalogue.ts`     | Catalogue filters and sorting, read safely from the URL; badges.         |
| `iso-date.ts`      | Checks ISO dates and works out an age on a given day.                    |
| `business-id.ts`   | Checks a Finnish business ID (Y-tunnus) and its check digit.             |
| `answer-check.ts`  | Checks one application answer against its question type.                 |
| `question-flow.ts` | Picks the next question and drops answers that stop applying.            |
| `eligibility.ts`   | Approved, declined or manual review, with the checks behind it.          |

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
