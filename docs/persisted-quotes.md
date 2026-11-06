# Persisted offers and signature price locks (#45)

## Offer saved when an application starts

The catalogue's **Apply** action sends the selected item, supported term, down payment and
start date to `POST /api/quotes`. The server recalculates the offer through
`priceContract()`/`quoteLease()`, using the same coefficient, discount and next-life pricing
rules as the sliders. It also selects VAT for the first invoice date. The server checks that
the calculated snapshot still matches the offer rendered by the catalogue before saving it.

The audited `Quote` row belongs to the current demo renter and stores the complete displayed
net rent, discount, buyout, first-invoice gross preview, price source/version and coefficient
identity alongside the lease choices and quote date. It is immutable through application
code. A per-offer request key makes a retry return the same quote. The quote id is carried
through application and signing; the server checks its owner, item and lease settings before
linking it to a contract. Reusing the id with another renter or changed settings is rejected.

## Price on the signing date locks

The default policy is that the price valid on the final signature date locks, even when it is
higher than the saved quote. A higher quote is not silently honoured. The signing page
compares the saved offer with the current server-calculated offer and explains whether monthly
net rent went down, went up or stayed the same, with the absolute difference in integer cents
(formatted as currency in the UI). `priceLockNote()` uses the reason codes
`cheaper_at_signing`, `more_expensive_at_signing` and `unchanged`.

The signing form's consent is tied to the displayed offer, including item, term, down
payment, start date, monthly net rent, buyout, list/source version and discount revision.
If it changes before submission, the API returns `PRICE_CHANGED`; the renter must refresh,
review and confirm again. The transaction checks the same snapshot again before it reserves
the item and writes the contract.

New contracts save `quoteId`, `quotedPriceListVersion` and `lockedPriceListVersion`. For
applications created before quote persistence, `quoteId` remains null and the displayed
signing-date version is recorded as both versions. Existing contract rows keep nullable quote
metadata; their saved amounts and documents are not rewritten.

## Company signatory review

When an applicant cannot sign for a company, the item is reserved and the contract remains in
`awaiting_signature`. Its current amounts are provisional. No invoices can be generated yet.
When the named signatory opens the contract, the server calculates the offer for that day
using the shared pricing and VAT rules. The page displays the current discount, net rent,
first-invoice gross and buyout, and explains any difference from the offer sent to them. The
signatory must explicitly accept that current offer. The API recalculates it in the audited
transaction and rejects stale consent. On success, that transaction replaces the provisional
financial snapshot, regenerates the PDF, writes the final lock date/version and activates the
contract. If the saved lease start date has passed, the signatory cannot sign; the applicant
must choose a new start date and send an updated application.

## Invoice VAT explanation

The contract's monthly net rent stays locked. Each saved invoice keeps its date, net amount,
VAT rate, VAT cents and gross amount. `explainInvoiceChange(previous, invoice)` returns
`vat_rate_changed` only when the dates increase, net rent is unchanged, the saved VAT rates
differ, and both gross amounts equal their saved net plus VAT cents. The invoice list then
explains the old and new rates, their invoice dates and the gross difference. It reads only
persisted invoice amounts; it does not recalculate or modify issued rows.

For the January 2027 change from 25.5% to 26%, a €107.30 net invoice remains €107.30 net;
the VAT changes from €27.36 to €27.90 and gross changes from €134.66 to €135.20. VAT is
rounded half up once per invoice in whole cents.

The schema migration for this feature was generated and applied to a fresh SQLite database in
`/tmp`. The configured local database was not used. The earlier
`20261105190012_contract_start_date` failure on populated legacy databases is documented in
[`money-core-integration.md`](money-core-integration.md); this feature does not rewrite or
resolve that migration.
