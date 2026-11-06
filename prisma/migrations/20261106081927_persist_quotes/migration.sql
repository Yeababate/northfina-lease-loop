-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestKey" TEXT NOT NULL,
    "renterId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL,
    "startOn" TEXT NOT NULL,
    "quotedOn" TEXT NOT NULL,
    "priceSource" TEXT NOT NULL,
    "priceListVersion" INTEGER NOT NULL,
    "coefficientVersion" INTEGER NOT NULL,
    "coefficientId" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "factor" REAL NOT NULL,
    "listPriceCents" INTEGER NOT NULL,
    "financedCents" INTEGER NOT NULL,
    "monthlyNetCents" INTEGER NOT NULL,
    "originalMonthlyNetCents" INTEGER NOT NULL,
    "monthlyDiscountCents" INTEGER NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "discountRuleId" TEXT,
    "discountRuleRevision" INTEGER,
    "buyoutNetCents" INTEGER NOT NULL,
    "vatPercent" REAL NOT NULL,
    "monthlyGrossCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT,
    "quotedPriceListVersion" INTEGER,
    "lockedPriceListVersion" INTEGER,
    "actor" TEXT NOT NULL,
    "renterId" TEXT,
    "providerId" TEXT,
    "assetId" TEXT NOT NULL,
    "startOn" TEXT NOT NULL,
    "endOn" TEXT NOT NULL,
    "signedOn" TEXT NOT NULL,
    "signatoryEmail" TEXT,
    "signatorySignedOn" TEXT,
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
    "discountRuleRevision" INTEGER,
    CONSTRAINT "Contract_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Contract" ("actor", "assetId", "band", "buyoutNetCents", "coefficientId", "coefficientVersion", "discountBps", "discountRuleId", "discountRuleRevision", "downPaymentCents", "endOn", "factor", "financedCents", "id", "listPriceCents", "monthlyDiscountCents", "monthlyNetCents", "originalMonthlyNetCents", "priceListVersion", "priceSource", "providerId", "renterId", "signatoryEmail", "signatorySignedOn", "signedOn", "startOn", "termMonths") SELECT "actor", "assetId", "band", "buyoutNetCents", "coefficientId", "coefficientVersion", "discountBps", "discountRuleId", "discountRuleRevision", "downPaymentCents", "endOn", "factor", "financedCents", "id", "listPriceCents", "monthlyDiscountCents", "monthlyNetCents", "originalMonthlyNetCents", "priceListVersion", "priceSource", "providerId", "renterId", "signatoryEmail", "signatorySignedOn", "signedOn", "startOn", "termMonths" FROM "Contract";
DROP TABLE "Contract";
ALTER TABLE "new_Contract" RENAME TO "Contract";
CREATE UNIQUE INDEX "Contract_quoteId_key" ON "Contract"("quoteId");
CREATE INDEX "Contract_assetId_idx" ON "Contract"("assetId");
CREATE INDEX "Contract_renterId_idx" ON "Contract"("renterId");
CREATE INDEX "Contract_providerId_idx" ON "Contract"("providerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_requestKey_key" ON "Quote"("requestKey");

-- CreateIndex
CREATE INDEX "Quote_renterId_assetId_idx" ON "Quote"("renterId", "assetId");
