import { randomUUID } from 'node:crypto';
import { prisma } from '../apps/api/src/lib/prisma.js';
import { hashToken } from '../apps/api/src/lib/security.js';
const sessions = [];
try {
  const assigned = await prisma.questProgress.findMany({ where: { ownerType: 'player', state: 'active' }, select: { campaignId: true, ownerId: true } });
  const members = await prisma.membership.findMany({ where: { role: 'player', OR: assigned.map(row => ({ campaignId: row.campaignId, user: { login: row.ownerId } })) }, select: { campaignId: true, user: { select: { id: true, login: true } } } });
  let visibleMissions = 0, editableObjectives = 0, blockedObjectives = 0;
  for (const member of members) {
    const token = randomUUID();
    const session = await prisma.session.create({ data: { userId: member.user.id, tokenHash: hashToken(token), csrfToken: randomUUID(), expiresAt: new Date(Date.now() + 60000) } }); sessions.push(session.id);
    const response = await fetch(`http://localhost:3001/api/v1/campaigns/${member.campaignId}/progress`, { headers: { cookie: `sao_session=${token}` } });
    if (!response.ok) throw new Error(`Player progress returned HTTP ${response.status}.`);
    const rows = await response.json();
    if (rows.some(row => row.ownerType === 'player' && row.ownerId !== member.user.login)) throw new Error('A player received another player’s mission.');
    for (const row of rows.filter(row => row.state === 'active')) {
      visibleMissions++;
      for (const objective of row.objectives) {
        if (objective.editable) editableObjectives++; else blockedObjectives++;
      }
    }
  }
  const disabledFlags = await prisma.questObjective.count({ where: { playerEditable: false } });
  if (disabledFlags) throw new Error('Some stored objectives remain disabled.');
  console.log(JSON.stringify({ checkedPlayers: members.length, visibleActiveMissions: visibleMissions, editableObjectives, objectivesBlockedByDependencies: blockedObjectives, disabledFlags }));
} finally {
  await prisma.session.deleteMany({ where: { id: { in: sessions } } });
  await prisma.$disconnect();
}
