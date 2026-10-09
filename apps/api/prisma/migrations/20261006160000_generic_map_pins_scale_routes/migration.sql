ALTER TABLE "MapBoard"
  ADD COLUMN "scaleStartX" DOUBLE PRECISION,
  ADD COLUMN "scaleStartY" DOUBLE PRECISION,
  ADD COLUMN "scaleEndX" DOUBLE PRECISION,
  ADD COLUMN "scaleEndY" DOUBLE PRECISION,
  ADD COLUMN "scaleDistanceKm" DOUBLE PRECISION,
  ADD COLUMN "scaleImageWidth" INTEGER,
  ADD COLUMN "scaleImageHeight" INTEGER;

ALTER TABLE "MapLocationPin"
  ADD COLUMN "entityType" TEXT NOT NULL DEFAULT 'location',
  ADD COLUMN "entityId" TEXT NOT NULL DEFAULT '';
UPDATE "MapLocationPin" SET "entityId" = "locationId";
ALTER TABLE "MapLocationPin" ALTER COLUMN "entityId" DROP DEFAULT;
ALTER TABLE "MapLocationPin" ALTER COLUMN "locationId" DROP NOT NULL;
DROP INDEX IF EXISTS "MapLocationPin_boardId_locationId_key";
CREATE UNIQUE INDEX "MapLocationPin_boardId_entityType_entityId_key" ON "MapLocationPin"("boardId", "entityType", "entityId");
CREATE INDEX "MapLocationPin_boardId_entityType_entityId_idx" ON "MapLocationPin"("boardId", "entityType", "entityId");

ALTER TABLE "MapRoute" ADD COLUMN "fromPinId" TEXT;
ALTER TABLE "MapRoute" ADD COLUMN "toPinId" TEXT;
ALTER TABLE "MapRoute" ADD COLUMN "sourceConnectionId" TEXT;
UPDATE "MapRoute" r SET "fromPinId" = p.id
  FROM "MapLocationPin" p WHERE p."boardId" = r."boardId" AND p."entityType" = 'location' AND p."entityId" = r."fromLocationId";
UPDATE "MapRoute" r SET "toPinId" = p.id
  FROM "MapLocationPin" p WHERE p."boardId" = r."boardId" AND p."entityType" = 'location' AND p."entityId" = r."toLocationId";
DELETE FROM "MapRoute" WHERE "fromPinId" IS NULL OR "toPinId" IS NULL;
ALTER TABLE "MapRoute" ALTER COLUMN "fromPinId" SET NOT NULL;
ALTER TABLE "MapRoute" ALTER COLUMN "toPinId" SET NOT NULL;
DROP INDEX IF EXISTS "MapRoute_boardId_fromLocationId_toLocationId_key";
ALTER TABLE "MapRoute" DROP COLUMN "fromLocationId";
ALTER TABLE "MapRoute" DROP COLUMN "toLocationId";
ALTER TABLE "MapRoute" DROP COLUMN "label";
CREATE UNIQUE INDEX "MapRoute_boardId_fromPinId_toPinId_key" ON "MapRoute"("boardId", "fromPinId", "toPinId");
CREATE INDEX "MapRoute_boardId_fromPinId_idx" ON "MapRoute"("boardId", "fromPinId");
CREATE INDEX "MapRoute_boardId_toPinId_idx" ON "MapRoute"("boardId", "toPinId");

ALTER TABLE "MapRoutePoint" DROP COLUMN "label";
