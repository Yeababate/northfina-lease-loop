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
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "downPaymentCents" INTEGER NOT NULL,
    "listPriceCents" INTEGER NOT NULL,
    "priceListVersion" INTEGER NOT NULL,
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
