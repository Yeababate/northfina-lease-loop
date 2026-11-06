-- AlterTable
ALTER TABLE "WaitingListEntry" ADD COLUMN "participantId" TEXT;

-- CreateIndex
CREATE INDEX "WaitingListEntry_participantId_idx" ON "WaitingListEntry"("participantId");
