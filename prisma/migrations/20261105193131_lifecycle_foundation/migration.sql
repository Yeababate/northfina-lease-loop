-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "providerId" TEXT;
ALTER TABLE "Contract" ADD COLUMN "renterId" TEXT;

-- CreateTable
CREATE TABLE "DemoUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalUsername" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "moderator" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ContractLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "listPriceCents" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL,
    "financedCents" INTEGER NOT NULL,
    "monthlyNetCents" INTEGER NOT NULL,
    "buyoutNetCents" INTEGER NOT NULL,
    "priceListVersion" INTEGER NOT NULL,
    "coefficientVersion" INTEGER NOT NULL,
    "coefficientId" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "factor" REAL NOT NULL,
    CONSTRAINT "ContractLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractLifecycle" (
    "contractId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'active',
    "actualEndOn" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ContractLifecycle_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractDocument" (
    "contractId" TEXT NOT NULL PRIMARY KEY,
    "locale" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "generatedAt" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    CONSTRAINT "ContractDocument_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoUser_canonicalUsername_key" ON "DemoUser"("canonicalUsername");

-- CreateIndex
CREATE UNIQUE INDEX "ContractLine_contractId_assetId_key" ON "ContractLine"("contractId", "assetId");

-- CreateIndex
CREATE INDEX "Contract_renterId_idx" ON "Contract"("renterId");

-- CreateIndex
CREATE INDEX "Contract_providerId_idx" ON "Contract"("providerId");
