-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiscountRule" (
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minTermMonths" INTEGER NOT NULL,
    "maxTermMonths" INTEGER NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "new_DiscountRule" ("discountBps", "enabled", "id", "maxTermMonths", "minTermMonths", "name", "providerId", "revision") SELECT "discountBps", "enabled", "id", "maxTermMonths", "minTermMonths", "name", "providerId", "revision" FROM "DiscountRule";
DROP TABLE "DiscountRule";
ALTER TABLE "new_DiscountRule" RENAME TO "DiscountRule";
CREATE INDEX "DiscountRule_providerId_idx" ON "DiscountRule"("providerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
