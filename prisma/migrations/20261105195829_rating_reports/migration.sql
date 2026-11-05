-- CreateTable
CREATE TABLE "RatingReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ratingId" TEXT NOT NULL,
    "ratingRevision" INTEGER NOT NULL,
    "revisionId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RatingReport_ratingId_fkey" FOREIGN KEY ("ratingId") REFERENCES "Rating" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RatingReport_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "RatingRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModerationDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "reviewedRevisionId" TEXT NOT NULL,
    "moderationVersion" INTEGER NOT NULL,
    "resultingVisibility" TEXT NOT NULL,
    "previousVisibility" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModerationDecision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "RatingReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModerationDecision_reviewedRevisionId_fkey" FOREIGN KEY ("reviewedRevisionId") REFERENCES "RatingRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Rating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "visibility" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "moderationVersion" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_Rating" ("comment", "contractId", "createdAt", "currentRevision", "direction", "id", "reviewerId", "stars", "subjectId", "updatedAt", "visibility") SELECT "comment", "contractId", "createdAt", "currentRevision", "direction", "id", "reviewerId", "stars", "subjectId", "updatedAt", "visibility" FROM "Rating";
DROP TABLE "Rating";
ALTER TABLE "new_Rating" RENAME TO "Rating";
CREATE INDEX "Rating_subjectId_direction_visibility_idx" ON "Rating"("subjectId", "direction", "visibility");
CREATE UNIQUE INDEX "Rating_contractId_reviewerId_key" ON "Rating"("contractId", "reviewerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RatingReport_status_createdAt_idx" ON "RatingReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RatingReport_ratingId_ratingRevision_reporterId_key" ON "RatingReport"("ratingId", "ratingRevision", "reporterId");

-- CreateIndex
CREATE INDEX "ModerationDecision_reportId_createdAt_idx" ON "ModerationDecision"("reportId", "createdAt");
