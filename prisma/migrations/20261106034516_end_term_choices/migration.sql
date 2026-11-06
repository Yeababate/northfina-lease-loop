-- CreateTable
CREATE TABLE "EndTermChoice" (
    "contractId" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "requestedOn" TEXT NOT NULL,
    "nomineeId" TEXT,
    "completedOn" TEXT,
    "nextContractId" TEXT,
    "settlementJson" TEXT,
    CONSTRAINT "EndTermChoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
