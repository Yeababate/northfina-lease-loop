# Rating report and moderation tooling

Issue #9 delivers services and APIs for later UI integration. No moderation page or
navigation is wired, following the updated lifecycle-tooling delivery scope. Basic
localized form components remain available but are not required to use the tooling.

## Identity and permissions

Run `npm run db:setup` to migrate and seed the local database. The trusted seed creates
(or promotes) the `moderator` demo username with `DemoUser.moderator = true`. Ordinary
username creation never grants this capability. Use the shared mock username selection
flow and its `lease-loop-user` cookie, not a browser role field. This is simulated login;
anyone using the demo can deliberately select its moderator identity. Real authentication
is outside this prototype.

Every API resolves its principal with `requirePrincipal(db, request)`. Commands take
stable actor IDs, then resolve the trusted user record again. Only a rating's subject
can submit a report. Authors and unrelated readers cannot report, even if they can read
public feedback. Moderator queue, detail and decision services each recheck capability.

## Typed server interfaces

Import from `src/server/rating-reports.ts`:

- `submitRatingReport(db, actorId, ratingId, input)` accepts
  `SubmitRatingReportInput`: `expectedRevision`, `reason`, optional `explanation`.
- `listOwnRatingReports(db, actorId)` returns `OwnRatingReport[]`, a private subject-only
  projection of ID, rating/revision, submitted reason/explanation, status and creation time.
  It excludes reporter identity, moderator identity, rationales and decision history.

Reasons are `abusive`, `misleading`, `spam`, `other`. Explanations are optional trimmed
plain text, at most 2000 characters. Repeated submissions for the same subject, rating
and immutable content revision return the existing case, including after that revision
has been edited. They neither replace its original reason nor write an extra audit.
A later current revision can have its own case. A new submission against an outdated
revision returns `STALE_CONTEXT`.

Import from `src/server/rating-moderation.ts`:

- `listModerationReports(db, actorId, includeResolved = false)` returns
  `ModerationQueueItem[]`. Default is pending; `true` includes the complete case history.
- `getModerationReport(db, actorId, reportId)` returns `ModerationCase`: immutable reported
  content, current rating and revision/visibility versions, every content revision, and
  all cases with chronological decision history for the same rating.
- `decideRatingReport(db, actorId, reportId, input: ModerationInput)` returns
  `ModerationDecisionResult`. Actions are `keep`, `hide`, `restore`. Every action requires
  a nonempty trimmed rationale, at most 2000 characters.

Before deciding, read the detail and pass its `version` as `expectedReportVersion`,
`rating.currentRevision` as `expectedRatingRevision`, and `rating.moderationVersion` as
`expectedModerationVersion`. An edit, another case decision or another visibility change
invalidates the context. On HTTP 409, reload the detail and review it before retrying.
Never silently retry with newer versions on the moderator's behalf.

Keep resolves a pending case as `kept` and leaves visibility unchanged. Hide resolves a
pending case as `hidden` and hides the entire current rating. Restore requires a hidden
rating and republishes its latest reviewed revision; it retains the case's original
outcome and appends a new decision. Thus a case may still have status `hidden` after its
rating is restored: case status records the resolution, while `rating.visibility` records
current publication. Resolved cases cannot be resolved again. Restore increments both
case and moderation versions, so concurrent restore attempts cannot both commit.

## JSON API

All endpoints use the repository envelope (`success/data/meta` or `success/error/meta`)
and safe `handleRoute` error handling. Request objects are strict: reporter IDs, subject
IDs, visibility flags and moderator capabilities cannot be supplied by the browser.

| Endpoint                      | Method | Purpose                                                               |
| ----------------------------- | ------ | --------------------------------------------------------------------- |
| `/api/ratings/:id/reports`    | POST   | Subject submits `{ expectedRevision, reason, explanation? }`          |
| `/api/ratings/:id/reports`    | GET    | Selected subject's reports for this rating                            |
| `/api/rating-reports`         | GET    | Selected subject's report outcomes                                    |
| `/api/moderation/reports`     | GET    | Moderator pending queue; `?all=1` includes resolved cases             |
| `/api/moderation/reports/:id` | GET    | Moderator evidence, current context and full history                  |
| `/api/moderation/reports/:id` | POST   | Moderator decision with action, rationale and three expected versions |

Expected errors include `LOGIN_REQUIRED` (401), `SUBJECT_REQUIRED`/`MODERATOR_REQUIRED`
(403), `RATING_NOT_FOUND`/`REPORT_NOT_FOUND` (404), `STALE_CONTEXT`/`INVALID_TRANSITION`
(409), and `INVALID_REPORT`/`INVALID_DECISION` (422). Schema/body errors use the shared
400 validation envelope. Clients should map codes to localized copy rather than display
unexpected server exception text.

## Evidence, publication and atomicity

`RatingReport.revisionId` references immutable `RatingRevision.id`; author edits append
new revisions. Hidden state survives author edits. Reports never create a second counted
rating. Pending and Keep leave public lists and scores unchanged. Hide excludes the rating
from public lists and role-specific sums/counts; Restore includes its latest revision
exactly once. The shared #7 `summarizeRatings` function owns aggregation.

Every mutation uses `withAudit` and its transaction client. Case changes, rating visibility,
append-only decisions and audit records commit together. Compare-and-set writes guard
content, case and cross-case visibility versions. A unique key on
`(ratingId, ratingRevision, reporterId)` prevents duplicate cases under concurrent retries.
Foreign keys restrict deletion of reported evidence.

Public rating responses never include report data. The public `/api/audit-log` feed omits
`rating_report` entries, which contain private actors and rationales. Those records remain
in the database; the capability-scoped detail exposes the corresponding decision history.
No outbound notifications or deferred lease-issue messaging are implemented.

## Verification

Adjacent domain tests cover validation, subject/moderator permissions, duplicate policy
and transitions. Real migrated SQLite integration tests cover subject/direct-API rejection,
concurrent submissions and decisions, version conflicts, immutable evidence, pending/Keep/
Hide/Restore aggregates, private projections, and atomic rollback on audit failure.
Run `npm run check:all` before handing this tooling to UI consumers.
