-- CreateTable
CREATE TABLE "ReminderPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "timeZone" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "rulesJson" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReminderOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "logicalKey" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "eventVersion" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "daysBefore" INTEGER NOT NULL,
    "deadlineAt" DATETIME NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "localDate" TEXT NOT NULL,
    "localTime" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "channelsJson" TEXT NOT NULL,
    "preferenceRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "lastErrorCode" TEXT,
    "claimToken" TEXT,
    "claimedUntil" DATETIME,
    "notificationId" TEXT,
    "coveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "ReminderCoverage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "occurrenceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    CONSTRAINT "ReminderCoverage_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "toAddress" TEXT,
    "subject" TEXT,
    "bodyText" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationReceipt" (
    "notificationId" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "readAt" DATETIME,
    CONSTRAINT "NotificationReceipt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReminderPreference_recipientId_idx" ON "ReminderPreference"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderPreference_contractId_recipientId_key" ON "ReminderPreference"("contractId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderOccurrence_logicalKey_key" ON "ReminderOccurrence"("logicalKey");

-- CreateIndex
CREATE INDEX "ReminderOccurrence_status_dueAt_idx" ON "ReminderOccurrence"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ReminderOccurrence_contractId_recipientId_idx" ON "ReminderOccurrence"("contractId", "recipientId");

-- CreateIndex
CREATE INDEX "Notification_recipientId_generatedAt_idx" ON "Notification"("recipientId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderCoverage_occurrenceId_channel_key" ON "ReminderCoverage"("occurrenceId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key" ON "NotificationDelivery"("notificationId", "channel");

-- CreateIndex
CREATE INDEX "NotificationReceipt_recipientId_readAt_idx" ON "NotificationReceipt"("recipientId", "readAt");
