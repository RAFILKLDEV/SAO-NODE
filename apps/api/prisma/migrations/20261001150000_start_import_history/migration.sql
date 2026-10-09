UPDATE "ImportHistory"
SET "sourceKind" = 'legacy'
WHERE "sourceKind" <> 'baseline';
