# Early-exit tooling

The prototype supports whole-contract return and ownership buyout. The UI is intentionally
left to later work. A future screen can consume `readExitView` or the scoped JSON endpoint
without reimplementing pricing, period calculations or transitions.

## Calculation boundaries

- `calculateEarlyCancellationFee({ monthlyRentCents, remainingMonths, elapsedMonths })`
  currently returns half the remaining rent, rounded once half up to cents.
- `calculateEarlyBuyoutPrice({ monthlyRentCents, remainingMonths, elapsedMonths,
endOfTermBuyoutCents })` returns remaining rent plus the signed final buyout.
- `previewEarlyExit` composes the accepted financial snapshot and a caller-supplied date.
  Policies can be replaced/injected without changing callers; method IDs are saved.
- Periods are anchored to the original start anniversary. Ends are exclusive. The current
  billing period stays earned; future months determine the placeholder fee/buyout.
- No down payment is credited twice, no cancellation fee is added to buyout, and normal
  rent already due is not silently converted into part of the exit calculation.

These are replaceable prototype policies, not a final valuation or fairness methodology.

## Commands and endpoint

`GET /api/contracts/[id]/exit` returns participant role, asset IDs, current lifecycle,
latest/open request and return/buyout quotes. A request includes a parsed frozen quote.
`ordinaryRentAndTax: provider_review_required` explicitly indicates that this tooling
does not invent a paid-invoice balance or cancellation-tax classification.

`POST` to the same endpoint accepts one of these strict command shapes:

- Request: `{ action: 'request', requestId, kind: 'return' | 'buyout', expectedQuote }`.
  Use a UUID as requestId and pass the reviewed quote unchanged. Duplicate identical
  request IDs are idempotent. A changed period, price, method or revision requires re-review.
- Withdraw: `{ action: 'withdraw', exitId, expectedRevision }`. Only the renter can
  withdraw a pending request before any physical receipt/payment processing.
- Receive: `{ action: 'receive', exitId, expectedRevision, assetIds, balancesReviewed }`.
  Only the provider can record receipt. Items must belong to the entire agreement.
- Paid: `{ action: 'paid', exitId, expectedRevision, balancesReviewed }`. Only the provider
  can acknowledge buyout settlement and transfer ownership.

Both provider actions require `balancesReviewed: true`: the provider explicitly reviews
ordinary balances and applicable tax outside this net exit-price estimate. This is an
acknowledgment in the mock, not a payment API, refund, or invented zero balance.
All API responses use the project's envelope and resolve the selected stable mock user.

## Completion and inventory

Return completion requires all physical assets received and the agreed period end.
Partial bundle receipts remain pending. Received items stay reserved until completion,
then become returned, never automatically available. Catalogue readiness also excludes
returned inventory until inspection/refurbishment/relisting makes it available.

Buyout completion updates settlement, ownership and lifecycle atomically. Bought items
stay unavailable to leasing inventory. Original financial terms and signing PDFs do not
change. Each completed contract/asset receives a unique completion event and increments
previous_lives once; repeated commands cannot create additional lives.

`finalizeDueReturns(db, today)` processes due receipts without a browser. Failures are
isolated per request and reported by ID. `runLifecycleTick` is the shared worker hook;
`startLifecycleWorker` runs an immediate pass then non-overlapping 30-second passes.
The Node instrumentation registration starts it for a running server, with hot-reload
deduplication and shutdown cleanup. Future notification work can reuse this scheduler
without tying completion to a logged-in user's session.

## Integration prerequisites

Stable DemoUser, nullable legacy participant mappings, ContractLine and ContractLifecycle
come from the shared issue #5 foundation. Unmapped historical contracts cannot be ended
using a display-name guess. New exits preserve the existing approval-gated signing flow.
The status contract consumed by ratings is `active`, `completed_return`, or
`completed_buyout`, with `actualEndOn` separate from the original signed end.
