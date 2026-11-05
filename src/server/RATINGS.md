# Ratings tooling

Ratings require a completed physical rental: ContractLifecycle.status must be
completed_return or completed_buyout. Passing endOn or submitting an exit request is
insufficient. Stable renterId/providerId determine reviewer/subject; actor is not identity.

## API

All routes use the shared JSON envelope. Mutations require the demo sign-in name (main's
lease-loop-name cookie), resolved to a stable participant ID by requirePrincipal (see
docs/profile-tooling.md). They accept no extra identity fields: strict schemas reject them.

- GET /api/contracts/:id/ratings returns the selected participant's rating or null.
- POST /api/contracts/:id/ratings accepts { stars, comment? } and creates one review.
- PATCH /api/ratings/:id accepts { stars, comment?, expectedRevision } for author edits.
- GET /api/users/:id/ratings returns public asProvider/asRenter summaries and visible
  reviews, without contract financial fields or private contact information.

Stars are integers 1–5. Optional plain text is trimmed and limited to 2000 characters.
Clients render comments as text, never HTML. New reviews publish immediately. A unique
(contractId, reviewerId) key rejects duplicates. Authors may edit indefinitely, with
optimistic revision checks. Every edit retains the same rating ID and appends immutable
RatingRevision evidence in the same audited transaction. Editing never clears hidden status.

## Reusable interfaces

src/domain/ratings.ts exports ratingEligibility, validateRating, planRatingEdit and
summarizeRatings. The server service exports createRating, editRating, ownContractRating
and publicRatings. Future UI consumers can call these API tools or server reads and use
averageTenths (null when there are no reviews) and count for role-separated displays.

The moderation feature owns visibility changes. RatingRevision.id is an immutable
report-evidence reference; a content edit appends another version rather than erasing it.
Only visible current ratings contribute to the public count and star sum. Hidden review
edits remain hidden until the moderation feature explicitly restores visibility.

One combined bundle agreement receives one review per participant, not one per asset.
No rating page/editor/profile layout is added here: presentation is deferred by the user.
