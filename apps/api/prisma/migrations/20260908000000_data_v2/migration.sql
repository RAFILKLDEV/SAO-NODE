ALTER TABLE "Entity" ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Entity" ALTER COLUMN "schemaVersion" SET DEFAULT 2;
ALTER TABLE "Reference" ADD COLUMN "slot" TEXT NOT NULL DEFAULT 'references';

-- Existing rows are legacy projections. They remain readable through the v1
-- adapter while new writes use the v2 canonical document.
CREATE INDEX "Reference_targetType_targetDomainId_slot_idx"
  ON "Reference"("targetType", "targetDomainId", "slot");

ALTER TABLE "Entity" ADD CONSTRAINT "Entity_type_check" CHECK ("type" IN ('npc','location','item','monster','quest')) NOT VALID;
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_visibility_check" CHECK ("baseVisibility" IN ('public','gm','discoverable')) NOT VALID;
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_version_check" CHECK ("version" > 0 AND "schemaVersion" IN (1,2)) NOT VALID;
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_quantity_check" CHECK (("chance" IS NULL OR "chance" BETWEEN 1 AND 100) AND ("quantityMin" IS NULL OR "quantityMin" > 0) AND ("quantityMax" IS NULL OR "quantityMax" > 0) AND ("quantityMin" IS NULL OR "quantityMax" IS NULL OR "quantityMax" >= "quantityMin")) NOT VALID;
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_slot_check" CHECK ("slot" IN ('references','locations','relations')) NOT VALID;
ALTER TABLE "NarrativeField" ADD CONSTRAINT "NarrativeField_visibility_check" CHECK ("visibility" IN ('public','gm','discoverable')) NOT VALID;
ALTER TABLE "LocationConnection" ADD CONSTRAINT "LocationConnection_values_check" CHECK (("distanceKm" IS NULL OR "distanceKm" >= 0) AND ("travelMinutes" IS NULL OR "travelMinutes" >= 0) AND "visibility" IN ('public','gm','discoverable') AND "access" IN ('public','discoverable','hidden','conditional','blocked')) NOT VALID;
ALTER TABLE "MonsterComponent" ADD CONSTRAINT "MonsterComponent_values_check" CHECK ("kind" IN ('movement','attack','ability','skill','trait') AND "visibility" IN ('public','gm','discoverable')) NOT VALID;
ALTER TABLE "QuestObjective" ADD CONSTRAINT "QuestObjective_values_check" CHECK ("requiredQuantity" > 0 AND "sortOrder" >= 0 AND "visibility" IN ('public','gm','discoverable')) NOT VALID;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_role_check" CHECK ("role" IN ('owner','gm','assistant_gm','player','spectator')) NOT VALID;
