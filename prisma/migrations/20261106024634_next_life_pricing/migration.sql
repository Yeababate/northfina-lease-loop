-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "nextLifePriceCents" INTEGER;
ALTER TABLE "Asset" ADD COLUMN "nextLifePricedOn" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "renterId" TEXT,
    "providerId" TEXT,
    "assetId" TEXT NOT NULL,
    "startOn" TEXT NOT NULL,
    "endOn" TEXT NOT NULL,
    "signedOn" TEXT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL,
    "listPriceCents" INTEGER NOT NULL,
    "priceListVersion" INTEGER NOT NULL,
    "priceSource" TEXT NOT NULL DEFAULT 'price_list',
    "coefficientVersion" INTEGER NOT NULL,
    "coefficientId" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "factor" REAL NOT NULL,
    "financedCents" INTEGER NOT NULL,
    "monthlyNetCents" INTEGER NOT NULL,
    "buyoutNetCents" INTEGER NOT NULL,
    "originalMonthlyNetCents" INTEGER,
    "monthlyDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "discountRuleId" TEXT,
    "discountRuleRevision" INTEGER
);
INSERT INTO "new_Contract" ("actor", "assetId", "band", "buyoutNetCents", "coefficientId", "coefficientVersion", "discountBps", "discountRuleId", "discountRuleRevision", "downPaymentCents", "endOn", "factor", "financedCents", "id", "listPriceCents", "monthlyDiscountCents", "monthlyNetCents", "originalMonthlyNetCents", "priceListVersion", "providerId", "renterId", "signedOn", "startOn", "termMonths") SELECT "actor", "assetId", "band", "buyoutNetCents", "coefficientId", "coefficientVersion", "discountBps", "discountRuleId", "discountRuleRevision", "downPaymentCents", "endOn", "factor", "financedCents", "id", "listPriceCents", "monthlyDiscountCents", "monthlyNetCents", "originalMonthlyNetCents", "priceListVersion", "providerId", "renterId", "signedOn", "startOn", "termMonths" FROM "Contract";
DROP TABLE "Contract";
ALTER TABLE "new_Contract" RENAME TO "Contract";
CREATE INDEX "Contract_assetId_idx" ON "Contract"("assetId");
CREATE INDEX "Contract_renterId_idx" ON "Contract"("renterId");
CREATE INDEX "Contract_providerId_idx" ON "Contract"("providerId");
CREATE TABLE "new_ContractLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "listPriceCents" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL,
    "financedCents" INTEGER NOT NULL,
    "monthlyNetCents" INTEGER NOT NULL,
    "buyoutNetCents" INTEGER NOT NULL,
    "priceListVersion" INTEGER NOT NULL,
    "priceSource" TEXT NOT NULL DEFAULT 'price_list',
    "coefficientVersion" INTEGER NOT NULL,
    "coefficientId" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "factor" REAL NOT NULL,
    CONSTRAINT "ContractLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContractLine" ("assetId", "band", "buyoutNetCents", "coefficientId", "coefficientVersion", "contractId", "downPaymentCents", "factor", "financedCents", "id", "listPriceCents", "monthlyNetCents", "priceListVersion") SELECT "assetId", "band", "buyoutNetCents", "coefficientId", "coefficientVersion", "contractId", "downPaymentCents", "factor", "financedCents", "id", "listPriceCents", "monthlyNetCents", "priceListVersion" FROM "ContractLine";
DROP TABLE "ContractLine";
ALTER TABLE "new_ContractLine" RENAME TO "ContractLine";
CREATE UNIQUE INDEX "ContractLine_contractId_assetId_key" ON "ContractLine"("contractId", "assetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
