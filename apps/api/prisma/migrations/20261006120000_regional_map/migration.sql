CREATE TABLE "MapBoard" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Mapa regional',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MapBoard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MapBoardRegion" (
  "id" TEXT NOT NULL,
  "boardId" TEXT NOT NULL,
  "regionId" TEXT NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "width" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "zIndex" INTEGER NOT NULL DEFAULT 0,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MapBoardRegion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MapLocationPin" (
  "id" TEXT NOT NULL,
  "boardId" TEXT NOT NULL,
  "regionId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "placementSource" TEXT NOT NULL DEFAULT 'auto',
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MapLocationPin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MapBoard_campaignId_key" ON "MapBoard"("campaignId");
CREATE INDEX "MapBoardRegion_boardId_zIndex_idx" ON "MapBoardRegion"("boardId", "zIndex");
CREATE UNIQUE INDEX "MapBoardRegion_boardId_regionId_key" ON "MapBoardRegion"("boardId", "regionId");
CREATE INDEX "MapLocationPin_boardId_regionId_idx" ON "MapLocationPin"("boardId", "regionId");
CREATE UNIQUE INDEX "MapLocationPin_boardId_locationId_key" ON "MapLocationPin"("boardId", "locationId");

ALTER TABLE "MapPosition" ADD COLUMN "regionId" TEXT;
ALTER TABLE "MapPositionHistory" ADD COLUMN "previousRegionId" TEXT;
ALTER TABLE "MapPositionHistory" ADD COLUMN "regionId" TEXT;

ALTER TABLE "MapBoard" ADD CONSTRAINT "MapBoard_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapBoard" ADD CONSTRAINT "MapBoard_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapBoardRegion" ADD CONSTRAINT "MapBoardRegion_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "MapBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapBoardRegion" ADD CONSTRAINT "MapBoardRegion_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapLocationPin" ADD CONSTRAINT "MapLocationPin_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "MapBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapLocationPin" ADD CONSTRAINT "MapLocationPin_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
