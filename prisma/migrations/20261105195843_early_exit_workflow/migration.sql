-- CreateTable
CREATE TABLE "ExitRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "openContractId" TEXT,
    "renterId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedOn" TEXT NOT NULL,
    "effectiveEndOn" TEXT NOT NULL,
    "quoteJson" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "balancesReviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "completedOn" TEXT,
    "completedBy" TEXT,
    CONSTRAINT "ExitRequest_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExitReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "exitId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "receivedOn" TEXT NOT NULL,
    "receivedBy" TEXT NOT NULL,
    CONSTRAINT "ExitReceipt_exitId_fkey" FOREIGN KEY ("exitId") REFERENCES "ExitRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetLifeCompletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "completedOn" TEXT NOT NULL,
    CONSTRAINT "AssetLifeCompletion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExitRequest_openContractId_key" ON "ExitRequest"("openContractId");

-- CreateIndex
CREATE INDEX "ExitRequest_contractId_idx" ON "ExitRequest"("contractId");

-- CreateIndex
CREATE INDEX "ExitRequest_status_effectiveEndOn_idx" ON "ExitRequest"("status", "effectiveEndOn");

-- CreateIndex
CREATE UNIQUE INDEX "ExitReceipt_exitId_assetId_key" ON "ExitReceipt"("exitId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetLifeCompletion_contractId_assetId_key" ON "AssetLifeCompletion"("contractId", "assetId");
