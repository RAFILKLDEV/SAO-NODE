CREATE TABLE "CharacterFavorite" (
  "campaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL CHECK ("targetType" IN ('npc', 'player')),
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterFavorite_pkey" PRIMARY KEY ("campaignId", "userId", "targetType", "targetId"),
  CONSTRAINT "CharacterFavorite_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CharacterFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
