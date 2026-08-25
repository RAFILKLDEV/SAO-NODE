CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "login" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "csrfToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Group" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "domainId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Entity" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "domainId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "baseVisibility" TEXT NOT NULL DEFAULT 'public',
  "data" JSONB NOT NULL,
  "source" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "localModifiedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NarrativeField" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NarrativeField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reference" (
  "id" TEXT NOT NULL,
  "sourceEntityId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetDomainId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "chance" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LocationConnection" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "targetDomainId" TEXT NOT NULL,
  "direction" TEXT,
  "distanceKm" DOUBLE PRECISION,
  "travelMinutes" INTEGER,
  "access" TEXT NOT NULL,
  "unlockCondition" TEXT,
  "visibility" TEXT NOT NULL,
  "data" JSONB,
  CONSTRAINT "LocationConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonsterComponent" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "componentId" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  CONSTRAINT "MonsterComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestObjective" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "requiredQuantity" INTEGER NOT NULL DEFAULT 1,
  "optional" BOOLEAN NOT NULL DEFAULT false,
  "secret" BOOLEAN NOT NULL DEFAULT false,
  "visibility" TEXT NOT NULL,
  "targetType" TEXT,
  "targetDomainId" TEXT,
  "dependsOn" JSONB NOT NULL,
  "playerEditable" BOOLEAN NOT NULL DEFAULT false,
  "data" JSONB,
  CONSTRAINT "QuestObjective_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestReward" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "rewardId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  CONSTRAINT "QuestReward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestProgress" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "questEntityId" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "QuestProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestObjectiveProgress" (
  "id" TEXT NOT NULL,
  "progressId" TEXT NOT NULL,
  "questObjectiveId" TEXT,
  "objectiveId" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "orphaned" BOOLEAN NOT NULL DEFAULT false,
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuestObjectiveProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Grant" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityDomainId" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "allowance" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityDomainId" TEXT,
  "targetKind" TEXT,
  "targetKey" TEXT,
  "subjectType" TEXT,
  "subjectId" TEXT,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CharacterBinding" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CharacterBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NpcAssociation" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "npcDomainId" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NpcAssociation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportHistory" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "packId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "importedByUserId" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE UNIQUE INDEX "Campaign_slug_key" ON "Campaign"("slug");
CREATE UNIQUE INDEX "Membership_campaignId_userId_key" ON "Membership"("campaignId", "userId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE UNIQUE INDEX "Group_campaignId_domainId_key" ON "Group"("campaignId", "domainId");
CREATE INDEX "Group_campaignId_idx" ON "Group"("campaignId");
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");
CREATE UNIQUE INDEX "Entity_campaignId_type_domainId_key" ON "Entity"("campaignId", "type", "domainId");
CREATE INDEX "Entity_campaignId_type_name_idx" ON "Entity"("campaignId", "type", "name");
CREATE INDEX "Entity_campaignId_domainId_idx" ON "Entity"("campaignId", "domainId");
CREATE UNIQUE INDEX "NarrativeField_entityId_key_key" ON "NarrativeField"("entityId", "key");
CREATE INDEX "NarrativeField_entityId_visibility_idx" ON "NarrativeField"("entityId", "visibility");
CREATE INDEX "Reference_sourceEntityId_idx" ON "Reference"("sourceEntityId");
CREATE INDEX "Reference_targetType_targetDomainId_idx" ON "Reference"("targetType", "targetDomainId");
CREATE UNIQUE INDEX "LocationConnection_entityId_connectionId_key" ON "LocationConnection"("entityId", "connectionId");
CREATE UNIQUE INDEX "MonsterComponent_entityId_kind_componentId_key" ON "MonsterComponent"("entityId", "kind", "componentId");
CREATE INDEX "MonsterComponent_entityId_kind_idx" ON "MonsterComponent"("entityId", "kind");
CREATE UNIQUE INDEX "QuestObjective_entityId_objectiveId_key" ON "QuestObjective"("entityId", "objectiveId");
CREATE INDEX "QuestObjective_entityId_sortOrder_idx" ON "QuestObjective"("entityId", "sortOrder");
CREATE UNIQUE INDEX "QuestReward_entityId_rewardId_key" ON "QuestReward"("entityId", "rewardId");
CREATE UNIQUE INDEX "QuestProgress_questEntityId_ownerType_ownerId_key" ON "QuestProgress"("questEntityId", "ownerType", "ownerId");
CREATE INDEX "QuestProgress_campaignId_ownerType_ownerId_idx" ON "QuestProgress"("campaignId", "ownerType", "ownerId");
CREATE UNIQUE INDEX "QuestObjectiveProgress_progressId_objectiveId_key" ON "QuestObjectiveProgress"("progressId", "objectiveId");
CREATE INDEX "QuestObjectiveProgress_questObjectiveId_idx" ON "QuestObjectiveProgress"("questObjectiveId");
CREATE UNIQUE INDEX "Grant_campaignId_subjectType_subjectId_entityType_entityDomainId_targetKind_targetKey_key" ON "Grant"("campaignId", "subjectType", "subjectId", "entityType", "entityDomainId", "targetKind", "targetKey");
CREATE INDEX "Grant_campaignId_entityType_entityDomainId_idx" ON "Grant"("campaignId", "entityType", "entityDomainId");
CREATE INDEX "AuditLog_campaignId_createdAt_idx" ON "AuditLog"("campaignId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityDomainId_idx" ON "AuditLog"("entityType", "entityDomainId");
CREATE UNIQUE INDEX "CharacterBinding_campaignId_userId_externalId_key" ON "CharacterBinding"("campaignId", "userId", "externalId");
CREATE UNIQUE INDEX "NpcAssociation_campaignId_npcDomainId_ownerType_ownerId_key" ON "NpcAssociation"("campaignId", "npcDomainId", "ownerType", "ownerId");
CREATE INDEX "ImportHistory_campaignId_packId_importedAt_idx" ON "ImportHistory"("campaignId", "packId", "importedAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Group" ADD CONSTRAINT "Group_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NarrativeField" ADD CONSTRAINT "NarrativeField_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationConnection" ADD CONSTRAINT "LocationConnection_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonsterComponent" ADD CONSTRAINT "MonsterComponent_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestObjective" ADD CONSTRAINT "QuestObjective_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestReward" ADD CONSTRAINT "QuestReward_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestProgress" ADD CONSTRAINT "QuestProgress_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestProgress" ADD CONSTRAINT "QuestProgress_questEntityId_fkey" FOREIGN KEY ("questEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestObjectiveProgress" ADD CONSTRAINT "QuestObjectiveProgress_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "QuestProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestObjectiveProgress" ADD CONSTRAINT "QuestObjectiveProgress_questObjectiveId_fkey" FOREIGN KEY ("questObjectiveId") REFERENCES "QuestObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterBinding" ADD CONSTRAINT "CharacterBinding_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterBinding" ADD CONSTRAINT "CharacterBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NpcAssociation" ADD CONSTRAINT "NpcAssociation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportHistory" ADD CONSTRAINT "ImportHistory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
