# End-of-term choices

`GET /api/contracts/:id/end-of-term` shows options to the lease participants. The renter can choose from 30 calendar days before the exclusive end date through the end date. The provider can complete a buyout and record a return from the usual receipt route.

- A renter sends `POST /api/contracts/:id/end-of-term` with `action: "choose"` and `kind: "end_buyout"`, `"end_return"`, or `"pass_on"`. A pass-on also includes the nominated demo renter's `nomineeId`.
- The provider confirms a buyout on or after the exclusive end date with `action: "paid"` and `expectedGrossCents`. The amount is the signed net buyout plus VAT on the payment day. This records a demo settlement and removes the item from the provider's stock.
- The return has zero extra charge. Receipt uses `POST /api/outgoing/contracts/:id/receipt`. The item follows the existing inspection and refurbishment workflow and the return closes at the end of the lease or when received, whichever is later.
- The nominee can read the new quote from the same end-of-term GET route on or after the original end date. The quote accepts `term` and `down` in cents. The nominee signs through `POST /api/contracts` with their approved application, the quoted amounts and source, and `passOnContractId`. Signing closes the original lease and reserves the same item for the new lease in one transaction. No return or refurbishment is recorded.
- The renter can withdraw an uncompleted choice with `action: "withdraw"` before the item is received. A pending pass-on keeps the item in the original lease until the nominee signs or the renter withdraws.
