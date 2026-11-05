# Participant and contract tooling

Issue #5 provides backend/domain tooling. Profile/login layouts, visual components,
notification editors and the new profile screen are deferred to the UI workstream.
Existing sign/contract pages have only thin adapters for principal scope, locale and PDF.

## Identity

`POST /api/demo-session` with `{ "username": "aino" }` selects a mock profile and sets
an HttpOnly session cookie. Names are trimmed, Unicode-normalized and case-insensitive.
Unknown names create stable empty profiles with an audit row. `DELETE /api/demo-session`
clears selection. This is intentionally mock identity selection, not authentication.

Server components use `currentPrincipal()` from `src/server/current-principal.ts`.
Route handlers use `requirePrincipal(db, request)` from `src/server/mock-users.ts`.
Replace those adapters with proper login later; participant relationships use stable IDs.
Never use the applicant's free-text `Contract.actor` as an authorization key.

Run `npm run db:setup` to initialize the synthetic participants/owners. Usernames match
persona ID suffixes (`aino`, `mikko`, etc.); `provider1`/`provider2` are sample providers.
Aino owns laptop-002 and can be renter/provider across different agreements. The seeder
does not attribute historical contracts to a user by matching their display names.

## Query endpoints

- `GET /api/profile?filter=all&sort=start_desc`: scoped incoming/outgoing contracts,
  summary cards, selected query and reporting date. Filters: all/current/ended. Sort:
  start_asc/start_desc/end_asc/end_desc. Overall summaries do not follow row filters.
- `GET /api/contracts/:id`: participant-scoped immutable contract, lines/lifecycle and
  original PDF metadata/download URL. Foreign IDs return the same missing-contract result.
- `GET /documents/contracts/:id`: saved PDF bytes for either participant. This binary
  route is outside `/api`; JSON APIs use the standard envelope. It checks stored digest,
  sets the signing language and disables shared caching.

Pure classification/filter/sort/summary functions and exported types are in
`src/domain/profile-leases.ts`. Start is inclusive; end is exclusive. An expired but
unreturned contract is temporally ended, not automatically operationally completed.
Active costs/income use locked monthly net rent, with per-contract date-effective VAT.

## Signing and originals

`POST /api/contracts` retains the existing lease/answer/expected-price fields and now
accepts `locale` (en/fi/sv/et, default en). A selected mock principal and configured
provider owner are required. Approval and company signatory checks still run on the
server. The selected principal is linked separately from the approved applicant name.

`signApplication` delegates to the existing audited signer. The PDF is prepared before
the transaction; availability/provider is checked again while reserving. Contract,
line snapshot, initial lifecycle, original PDF and audit row commit together. Rendering
or audit failure leaves no partial signed contract/reservation/document.

The renderer uses bundled DejaVu Sans (license in assets/fonts) for Finnish, Swedish
and Estonian text. It saves one signing-language original, template version, real
generation timestamp and SHA-256 digest. Later price/template/UI-language changes
do not replace the saved bytes. The document explicitly identifies mock signing.

`signContract` is the low-level trusted service retained for existing integrations/tests;
HTTP signing always goes through `signApplication` and `requirePrincipal`. New public
routes must never call the low-level signer to bypass application approval.

## Compatible legacy and lifecycle integration

Existing financial scalar fields remain intact. Normal leases get one ContractLine;
future bundles can extend this to multiple lines under the same agreement. Mutable
ContractLifecycle is separate from the locked financial snapshot; #6 owns exit transitions.

Trusted operator services in `src/server/legacy-contracts.ts` provide explicit audited
participant mapping and exact line backfill. They have no public endpoint. Mapping
requires known distinct IDs and refuses to overwrite a mapping. Line backfill copies
saved amounts without consulting current price lists. Neither helper invents an original
PDF or backdates one. Ambiguous legacy ownership and missing originals remain explicit.

Future notification preferences/inbox tooling belongs to #10 and can attach to these
contract/principal IDs. Return/refurbishment management belongs to #12. No messaging,
reminder worker, rating form or polished dashboard is implemented by this issue.
