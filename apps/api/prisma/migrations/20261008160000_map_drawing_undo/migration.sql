CREATE TABLE "MapDrawing" (
  "id" TEXT NOT NULL, "boardId" TEXT NOT NULL, "authorUserId" TEXT NOT NULL,
  "data" JSONB NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MapDrawing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MapDrawing_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "MapBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MapDrawing_boardId_active_createdAt_idx" ON "MapDrawing"("boardId", "active", "createdAt");
CREATE TABLE "MapEdit" (
  "id" TEXT NOT NULL, "boardId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
  "label" TEXT NOT NULL, "before" JSONB NOT NULL, "after" JSONB NOT NULL, "expected" JSONB NOT NULL,
  "applied" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MapEdit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MapEdit_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "MapBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MapEdit_boardId_actorUserId_createdAt_idx" ON "MapEdit"("boardId", "actorUserId", "createdAt");
