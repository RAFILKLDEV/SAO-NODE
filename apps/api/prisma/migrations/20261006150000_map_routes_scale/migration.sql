ALTER TABLE "MapBoard" ADD COLUMN "scaleKm" DOUBLE PRECISION;

CREATE TABLE "MapRoute" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "label" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MapRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MapRoutePoint" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "order" INTEGER NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MapRoutePoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MapRoute_boardId_fromLocationId_toLocationId_key" ON "MapRoute"("boardId", "fromLocationId", "toLocationId");
CREATE INDEX "MapRoute_boardId_createdAt_idx" ON "MapRoute"("boardId", "createdAt");
CREATE UNIQUE INDEX "MapRoutePoint_routeId_order_key" ON "MapRoutePoint"("routeId", "order");
CREATE INDEX "MapRoutePoint_routeId_order_idx" ON "MapRoutePoint"("routeId", "order");

ALTER TABLE "MapRoute" ADD CONSTRAINT "MapRoute_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "MapBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapRoute" ADD CONSTRAINT "MapRoute_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapRoutePoint" ADD CONSTRAINT "MapRoutePoint_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "MapRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapRoutePoint" ADD CONSTRAINT "MapRoutePoint_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
