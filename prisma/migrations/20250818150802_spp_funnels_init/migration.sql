-- CreateTable
CREATE TABLE "Funnel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountPct" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FunnelTrigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funnelId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    CONSTRAINT "FunnelTrigger_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FunnelOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funnelId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FunnelOffer_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "orderId" TEXT NOT NULL DEFAULT '',
    "triggerGid" TEXT NOT NULL DEFAULT '',
    "offerGid" TEXT,
    "accepted" BOOLEAN NOT NULL,
    "revenueUsd" REAL NOT NULL DEFAULT 0,
    "discountUsd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "FunnelTrigger_productGid_key" ON "FunnelTrigger"("productGid");
