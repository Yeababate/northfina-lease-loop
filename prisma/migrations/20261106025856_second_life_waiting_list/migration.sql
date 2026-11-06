-- CreateTable
CREATE TABLE "WaitingListEntry" (
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
    "offerJson" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitingListEntry_offeredAssetId_key" ON "WaitingListEntry"("offeredAssetId");
