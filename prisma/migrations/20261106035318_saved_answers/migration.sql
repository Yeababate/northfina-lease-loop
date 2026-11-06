-- CreateTable
CREATE TABLE "SavedAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "answeredOn" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SavedAnswer_userId_idx" ON "SavedAnswer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedAnswer_userId_profileKey_questionId_key" ON "SavedAnswer"("userId", "profileKey", "questionId");
