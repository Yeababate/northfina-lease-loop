-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AssetOwnership" (
    "assetId" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ContractProvider" (
    "contractId" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ReturnIntake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "contractId" TEXT,
    "providerId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "receivedOn" TEXT,
    "receivedBy" TEXT,
    "completedOn" TEXT,
    "relistedOn" TEXT,
    "relistedBy" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "ReturnInspection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intakeId" TEXT NOT NULL,
    "inspectedOn" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "conditionBefore" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "usageBefore" INTEGER NOT NULL,
    "usageValue" INTEGER NOT NULL,
    "hoursSinceService" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReturnInspection_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "ReturnIntake" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RefurbishmentWork" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intakeId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "performedOn" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "conditionBefore" TEXT NOT NULL,
    "conditionAfter" TEXT NOT NULL,
    "usageBefore" INTEGER NOT NULL,
    "usageAfter" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefurbishmentWork_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "ReturnIntake" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetLifecycleEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assetId" TEXT NOT NULL,
    "intakeId" TEXT,
    "contractId" TEXT,
    "type" TEXT NOT NULL,
    "on" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detailsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AssetOwnership_providerId_idx" ON "AssetOwnership"("providerId");

-- CreateIndex
CREATE INDEX "ContractProvider_providerId_idx" ON "ContractProvider"("providerId");

-- CreateIndex
CREATE INDEX "ReturnIntake_providerId_idx" ON "ReturnIntake"("providerId");

-- CreateIndex
CREATE INDEX "ReturnIntake_assetId_idx" ON "ReturnIntake"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnIntake_contractId_assetId_key" ON "ReturnIntake"("contractId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "RefurbishmentWork_intakeId_actionId_key" ON "RefurbishmentWork"("intakeId", "actionId");

-- CreateIndex
CREATE INDEX "AssetLifecycleEvent_assetId_idx" ON "AssetLifecycleEvent"("assetId");
