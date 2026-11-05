-- CreateTable
CREATE TABLE "BundleOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "terms_json" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BundleOfferItem" (
    "offerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    PRIMARY KEY ("offerId", "assetId"),
    CONSTRAINT "BundleOfferItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "BundleOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BundleOffer_providerId_idx" ON "BundleOffer"("providerId");

-- CreateIndex
CREATE INDEX "BundleOfferItem_assetId_idx" ON "BundleOfferItem"("assetId");
