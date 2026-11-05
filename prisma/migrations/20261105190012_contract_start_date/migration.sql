/*
  Warnings:

  - Added the required column `startOn` to the `Contract` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "startOn" TEXT NOT NULL,
    "endOn" TEXT NOT NULL,
    "signedOn" TEXT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL,
    "listPriceCents" INTEGER NOT NULL,
    "priceListVersion" INTEGER NOT NULL,
    "coefficientVersion" INTEGER NOT NULL,
    "coefficientId" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "factor" REAL NOT NULL,
    "financedCents" INTEGER NOT NULL,
    "monthlyNetCents" INTEGER NOT NULL,
    "buyoutNetCents" INTEGER NOT NULL
);
INSERT INTO "new_Contract" ("actor", "assetId", "band", "buyoutNetCents", "coefficientId", "coefficientVersion", "downPaymentCents", "endOn", "factor", "financedCents", "id", "listPriceCents", "monthlyNetCents", "priceListVersion", "signedOn", "termMonths") SELECT "actor", "assetId", "band", "buyoutNetCents", "coefficientId", "coefficientVersion", "downPaymentCents", "endOn", "factor", "financedCents", "id", "listPriceCents", "monthlyNetCents", "priceListVersion", "signedOn", "termMonths" FROM "Contract";
DROP TABLE "Contract";
ALTER TABLE "new_Contract" RENAME TO "Contract";
CREATE INDEX "Contract_assetId_idx" ON "Contract"("assetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
