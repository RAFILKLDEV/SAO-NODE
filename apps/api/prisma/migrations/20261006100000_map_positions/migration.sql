CREATE TABLE "MapSession" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Sessão de jogo',
  "createdByUserId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "MapSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MapPosition" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MapPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MapPositionHistory" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "positionId" TEXT,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "previousLocationId" TEXT,
  "previousX" DOUBLE PRECISION,
  "previousY" DOUBLE PRECISION,
  "locationId" TEXT NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "changedByUserId" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revertedAt" TIMESTAMP(3),
  "revertedByUserId" TEXT,
  "revertsHistoryId" TEXT,
  CONSTRAINT "MapPositionHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MapSession_campaignId_endedAt_startedAt_idx" ON "MapSession"("campaignId", "endedAt", "startedAt");
CREATE UNIQUE INDEX "MapPosition_sessionId_ownerType_ownerId_key" ON "MapPosition"("sessionId", "ownerType", "ownerId");
CREATE INDEX "MapPosition_sessionId_locationId_idx" ON "MapPosition"("sessionId", "locationId");
CREATE UNIQUE INDEX "MapPositionHistory_revertsHistoryId_key" ON "MapPositionHistory"("revertsHistoryId");
CREATE INDEX "MapPositionHistory_sessionId_changedAt_idx" ON "MapPositionHistory"("sessionId", "changedAt");
CREATE INDEX "MapPositionHistory_sessionId_ownerType_ownerId_changedAt_idx" ON "MapPositionHistory"("sessionId", "ownerType", "ownerId", "changedAt");

ALTER TABLE "MapSession" ADD CONSTRAINT "MapSession_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapSession" ADD CONSTRAINT "MapSession_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapPosition" ADD CONSTRAINT "MapPosition_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "MapSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapPosition" ADD CONSTRAINT "MapPosition_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MapPositionHistory" ADD CONSTRAINT "MapPositionHistory_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "MapSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapPositionHistory" ADD CONSTRAINT "MapPositionHistory_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "MapPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MapPositionHistory" ADD CONSTRAINT "MapPositionHistory_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
