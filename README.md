# Lease Loop

We built Lease Loop for the Northfina × Hive Helsinki hackathon. It follows an e-bike, laptop or farm machine from its first quote through signing, monthly invoices and handover to its next renter. The app runs in English, Finnish, Swedish and Estonian.

## My contribution

My focus was the Money Core. When a renter starts an application, we save the offer they saw. At signing, we compare that quote with the current price and ask the renter to accept the final terms. The contract records the agreed monthly net rent, buyout and dealer discount. That lets us explain later changes in the invoice total.

For example, in our demo, Aino leases `ebike-003` for 36 months with no down payment. Her monthly net rent is €107.30. Her December invoice is €134.66 including VAT. In January it becomes €135.20 because the challenge data changes the VAT rate from 25.5% to 26%. Both invoices show the same agreed rent. [See the scenario test](tests/scenarios/01-happy-path.test.ts).

## Run locally

Install Git and Node.js 22. The project pins its Node version in [.nvmrc](.nvmrc). From a terminal, run:

```bash
git clone https://github.com/Yeababate/northfina-lease-loop.git
cd northfina-lease-loop
npm ci
npm run db:setup
npm run dev
```

Open [the English catalogue](http://localhost:3000/en). The setup command creates the local environment file if needed, applies the SQLite migrations and seeds the catalogue.

To replay Aino’s example, start the server with the demo date set to 5 November 2026:

```bash
env LEASE_LOOP_TODAY=2026-11-05 npm run dev
```

## Try the lease journey

1. Sign in with a demo name, open an item in the catalogue and move the term and down-payment sliders. The price breakdown shows how much you finance, the monthly rent and the end-of-term buyout.
2. Select **Apply**, answer the eligibility questions and review the saved quote at signing. If a company applicant needs someone else to sign, the lease waits for that person’s approval.
3. Open the signed contract and generate its invoices. Compare two months to see how the invoice date determines VAT.
4. At the end of a lease, explore buying, returning or passing on the item. The team’s lifecycle flow covers used-item pricing, refurbishment, waiting-list matching and an item passport showing its recorded lives.

## Code and tests

The project uses TypeScript, Next.js, Prisma and SQLite. The [domain functions](src/domain) calculate prices, eligibility and invoice dates. The [server layer](src/server) stores quotes, contracts and invoices and records an audit entry alongside each business change.

Run `npm test -- tests/scenarios` for the challenge examples or `npm run check:all` for formatting, linting, type checking, coverage and the production build. The [Money Core tests](src/domain/money-properties.test.ts) also exercise invoice dates, discounts and cent totals across generated lease examples.

## Credits

I maintain this repository under [Yeababate](https://github.com/Yeababate). Lease Loop was a team project. Northfina supplied the [challenge](CHALLENGE.md), [engineering rules](RULES.md) and [synthetic data pack](data/DATA.md). The starter code and data pack are covered by the [MIT license](LICENSE). The hackathon team owns the code it contributed.
