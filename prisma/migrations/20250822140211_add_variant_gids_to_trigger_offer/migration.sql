/*
  Warnings:

  - You are about to drop the `FunnelOffer` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FunnelTrigger` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "FunnelOffer";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "FunnelTrigger";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Trigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funnelId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "variantGids" JSONB,
    CONSTRAINT "Trigger_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funnelId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "variantGids" JSONB,
    CONSTRAINT "Offer_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Trigger_funnelId_idx" ON "Trigger"("funnelId");

-- CreateIndex
CREATE INDEX "Offer_funnelId_idx" ON "Offer"("funnelId");
