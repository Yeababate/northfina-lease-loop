-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
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

-- CreateIndex
CREATE INDEX "Contract_assetId_idx" ON "Contract"("assetId");
