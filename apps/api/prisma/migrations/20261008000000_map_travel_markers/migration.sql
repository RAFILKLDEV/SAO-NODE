-- Independent travel positions preserve the location-bound session history.
CREATE TABLE "MapTravelMarker" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MapTravelMarker_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MapTravelMarker_coordinates_check" CHECK ("x" >= 0 AND "x" <= 1 AND "y" >= 0 AND "y" <= 1),
    CONSTRAINT "MapTravelMarker_owner_check" CHECK ("ownerType" IN ('player', 'group', 'custom'))
);
CREATE UNIQUE INDEX "MapTravelMarker_boardId_ownerType_ownerId_key" ON "MapTravelMarker"("boardId", "ownerType", "ownerId");
CREATE INDEX "MapTravelMarker_boardId_idx" ON "MapTravelMarker"("boardId");
ALTER TABLE "MapTravelMarker" ADD CONSTRAINT "MapTravelMarker_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "MapBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapTravelMarker" ADD CONSTRAINT "MapTravelMarker_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
