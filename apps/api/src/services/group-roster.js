import { prisma } from '../lib/prisma.js';
import { getEntityForRequest } from './content.js';

export async function groupCharacters(request, groupIds) {
  const result = new Map(groupIds.map(id => [id, []]));
  if (!groupIds.length) return result;
  const associations = await prisma.npcAssociation.findMany({ where: { campaignId: request.campaign.id, ownerType: 'group', ownerId: { in: groupIds } }, select: { ownerId: true, npcDomainId: true }, orderBy: { createdAt: 'asc' } });
  const cache = new Map();
  for (const association of associations) {
    if (!cache.has(association.npcDomainId)) cache.set(association.npcDomainId, getEntityForRequest({ request, type: 'npc', domainId: association.npcDomainId, options: { backlinks: false, format: '1', requireSection: 'basic' } }));
    const character = await cache.get(association.npcDomainId);
    if (character && result.has(association.ownerId)) result.get(association.ownerId).push({ id: character.id, name: character.name, characterType: character.characterType ?? 'npc' });
  }
  return result;
}

export async function groupRoster(request, groupId) {
  if (groupId === request.campaign.id) {
    const rows = await prisma.membership.findMany({ where: { campaignId: request.campaign.id, role: 'player' }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: 'asc' } } });
    return { id: groupId, name: 'Grupo da campanha', members: rows.map(row => ({ id: row.userId, name: row.user.name, type: 'player' })) };
  }
  const group = await prisma.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: groupId } }, include: { members: { select: { user: { select: { id: true, name: true } } } } } });
  if (!group) return null;
  const characters = (await groupCharacters(request, [groupId])).get(groupId);
  return { id: groupId, name: group.name, members: [...group.members.map(({ user }) => ({ id: user.id, name: user.name, type: 'player' })), ...characters.map(character => ({ ...character, type: 'npc' }))] };
}
