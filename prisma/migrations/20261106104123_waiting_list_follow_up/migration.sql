-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "contractId" TEXT,
    "waitingListEntryId" TEXT,
    "eventVersion" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "endOn" TEXT NOT NULL,
    "deadlineAt" DATETIME NOT NULL,
    "originalDueAt" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "catchUp" BOOLEAN NOT NULL,
    "timingJson" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "preferenceRevision" INTEGER NOT NULL
);
INSERT INTO "new_Notification" ("catchUp", "contractId", "deadlineAt", "endOn", "eventVersion", "generatedAt", "id", "kind", "locale", "originalDueAt", "payloadJson", "preferenceRevision", "recipientId", "timeZone", "timingJson") SELECT "catchUp", "contractId", "deadlineAt", "endOn", "eventVersion", "generatedAt", "id", "kind", "locale", "originalDueAt", "payloadJson", "preferenceRevision", "recipientId", "timeZone", "timingJson" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_recipientId_generatedAt_idx" ON "Notification"("recipientId", "generatedAt");
CREATE TABLE "new_WaitingListEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "maxMonthlyNetRentCents" INTEGER NOT NULL,
    "minCondition" TEXT NOT NULL,
    "preferredTermMonths" INTEGER NOT NULL,
    "neededBy" TEXT NOT NULL,
    "signedUpOn" TEXT NOT NULL,
    "who" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "offeredAssetId" TEXT,
    "offeredIntakeId" TEXT,
    "offeredOn" TEXT,
    "offerJson" TEXT,
    "participantId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "stillWantedAskedOn" TEXT,
    "expiredOn" TEXT,
    "expiredReason" TEXT
);
INSERT INTO "new_WaitingListEntry" ("category", "id", "maxMonthlyNetRentCents", "minCondition", "neededBy", "offerJson", "offeredAssetId", "offeredIntakeId", "offeredOn", "participantId", "preferredTermMonths", "signedUpOn", "status", "who") SELECT "category", "id", "maxMonthlyNetRentCents", "minCondition", "neededBy", "offerJson", "offeredAssetId", "offeredIntakeId", "offeredOn", "participantId", "preferredTermMonths", "signedUpOn", "status", "who" FROM "WaitingListEntry";
DROP TABLE "WaitingListEntry";
ALTER TABLE "new_WaitingListEntry" RENAME TO "WaitingListEntry";
CREATE UNIQUE INDEX "WaitingListEntry_offeredAssetId_key" ON "WaitingListEntry"("offeredAssetId");
CREATE INDEX "WaitingListEntry_participantId_idx" ON "WaitingListEntry"("participantId");
CREATE INDEX "WaitingListEntry_status_idx" ON "WaitingListEntry"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
