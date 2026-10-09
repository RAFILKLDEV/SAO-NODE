import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  const rows = await db.questProgress.findMany({ where: { state: 'active', ownerType: { in: ['player', 'group'] } }, select: { ownerType: true, questEntity: { select: { questObjectives: { select: { playerEditable: true, secret: true } } } } } });
  console.log(JSON.stringify({ activeMissions: rows.length, playerMissions: rows.filter(row => row.ownerType === 'player').length, missionsWithPlayerEditableObjectives: rows.filter(row => row.questEntity.questObjectives.some(objective => objective.playerEditable && !objective.secret)).length }));
} finally { await db.$disconnect(); }
