-- Preserve the existing campaign map as the general map, with all pins/routes/scale intact.
ALTER TABLE "MapBoard"
  ADD COLUMN "boardKey" TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN "regionId" TEXT;

DROP INDEX "MapBoard_campaignId_key";
CREATE UNIQUE INDEX "MapBoard_campaignId_boardKey_key" ON "MapBoard"("campaignId", "boardKey");
CREATE UNIQUE INDEX "MapBoard_campaignId_regionId_key" ON "MapBoard"("campaignId", "regionId");
ALTER TABLE "MapBoard" ADD CONSTRAINT "MapBoard_region_key_check"
  CHECK (("regionId" IS NULL AND "boardKey" = 'general') OR ("regionId" IS NOT NULL AND "boardKey" = 'region:' || "regionId"));

CREATE TABLE "MapRegionBoundary" (
  "id" TEXT NOT NULL,
  "boardId" TEXT NOT NULL,
  "regionId" TEXT NOT NULL,
  "points" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MapRegionBoundary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MapRegionBoundary_boardId_regionId_key" ON "MapRegionBoundary"("boardId", "regionId");
ALTER TABLE "MapRegionBoundary" ADD CONSTRAINT "MapRegionBoundary_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "MapBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapRegionBoundary" ADD CONSTRAINT "MapRegionBoundary_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
