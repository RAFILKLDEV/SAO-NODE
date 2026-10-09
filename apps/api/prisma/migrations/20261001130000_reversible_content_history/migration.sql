ALTER TABLE "AuditLog"
  ADD COLUMN "resultVersion" INTEGER,
  ADD COLUMN "revertedAt" TIMESTAMP(3),
  ADD COLUMN "revertedByUserId" TEXT,
  ADD COLUMN "revertsAuditId" TEXT;

CREATE UNIQUE INDEX "AuditLog_revertsAuditId_key" ON "AuditLog"("revertsAuditId");

ALTER TABLE "ImportHistory"
  ADD COLUMN "changes" JSONB,
  ADD COLUMN "reversibleCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revertedAt" TIMESTAMP(3),
  ADD COLUMN "revertedByUserId" TEXT;

ALTER TABLE "ImportHistory"
  ALTER COLUMN "importedByUserId" DROP NOT NULL;

INSERT INTO "ImportHistory" (
  "id",
  "campaignId",
  "packId",
  "fileName",
  "sourceKind",
  "summary",
  "changes",
  "reversibleCount",
  "importedByUserId",
  "importedAt"
)
SELECT
  'baseline-' || campaign."id",
  campaign."id",
  'initial-baseline',
  'Estado inicial da base',
  'baseline',
  jsonb_build_object('entities', COUNT(entity."id")),
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'type', entity."type",
        'id', entity."domainId",
        'status', 'BASELINE',
        'before', NULL,
        'after', jsonb_build_object(
          'data', entity."data",
          'source', entity."source",
          'deletedAt', entity."deletedAt" IS NOT NULL
        ),
        'resultVersion', entity."version"
      )
      ORDER BY entity."type", entity."domainId"
    ) FILTER (WHERE entity."id" IS NOT NULL),
    '[]'::jsonb
  ),
  0,
  NULL,
  CURRENT_TIMESTAMP
FROM "Campaign" AS campaign
LEFT JOIN "Entity" AS entity ON entity."campaignId" = campaign."id"
GROUP BY campaign."id";
