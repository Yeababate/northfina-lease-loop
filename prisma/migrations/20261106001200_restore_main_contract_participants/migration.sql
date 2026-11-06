-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "providerId" TEXT;
ALTER TABLE "Contract" ADD COLUMN "renterId" TEXT;

-- CreateIndex
CREATE INDEX "Contract_renterId_idx" ON "Contract"("renterId");

-- CreateIndex
CREATE INDEX "Contract_providerId_idx" ON "Contract"("providerId");
