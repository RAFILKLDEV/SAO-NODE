ALTER TABLE "Reference" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_visibility_check" CHECK ("visibility" IN ('public', 'discoverable', 'gm'));
