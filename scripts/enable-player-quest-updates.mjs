import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prisma } from '../apps/api/src/lib/prisma.js';
import { audit } from '../apps/api/src/lib/audit.js';

export async function enablePlayerQuestUpdates({ campaignId, actorUserId, db = prisma }) {
  if (!campaignId || !actorUserId) throw new Error('Campaign and actor are required.');
  return db.$transaction(async tx => {
    const quests = await tx.entity.findMany({
      where: { campaignId, type: 'quest', questObjectives: { some: { playerEditable: false } } },
      select: { id: true, domainId: true, version: true, data: true, questObjectives: { where: { playerEditable: false }, select: { objectiveId: true, playerEditable: true } } }
    });
    let objectives = 0;
    for (const quest of quests) {
      const data = Array.isArray(quest.data.objectives) ? { ...quest.data, objectives: quest.data.objectives.map(objective => ({ ...objective, playerEditable: true })) } : undefined;
      const claimed = await tx.entity.updateMany({ where: { id: quest.id, campaignId, version: quest.version }, data: { version: { increment: 1 }, localModifiedAt: new Date(), ...(data ? { data } : {}) } });
      if (claimed.count !== 1) throw Object.assign(new Error('Mission changed during the update.'), { code: 'VERSION_CONFLICT' });
      const updated = await tx.questObjective.updateMany({ where: { entityId: quest.id, playerEditable: false }, data: { playerEditable: true } });
      objectives += updated.count;
      await audit(tx, {
        campaignId, actorUserId, action: 'quest.objectives.player-editable.enable', entityType: 'quest', entityDomainId: quest.domainId,
        targetKind: 'objectives', targetKey: 'playerEditable', resultVersion: quest.version + 1,
        before: { objectives: quest.questObjectives }, after: { objectives: quest.questObjectives.map(objective => ({ ...objective, playerEditable: true })) }
      });
    }
    return { missions: quests.length, objectives };
  }, { isolationLevel: 'Serializable', timeout: 60000 });
}

async function main() {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { entities: { some: { type: 'quest', questObjectives: { some: { playerEditable: false } } } } },
      select: { id: true, memberships: { where: { role: { in: ['owner', 'gm', 'assistant_gm'] } }, select: { userId: true, role: true } } }
    });
    const before = await prisma.questObjective.findMany({ where: { playerEditable: false }, select: { id: true, entityId: true, objectiveId: true, playerEditable: true, entity: { select: { campaignId: true, domainId: true, version: true } } }, orderBy: { id: 'asc' } });
    if (!process.argv.includes('--apply')) {
      console.log(JSON.stringify({ campaigns: campaigns.length, objectivesToEnable: before.length, apply: false })); return;
    }
    const scopes = campaigns.map(campaign => {
      const actor = ['owner', 'gm', 'assistant_gm'].map(role => campaign.memberships.find(member => member.role === role)).find(Boolean);
      if (!actor) throw new Error(`No campaign owner found for ${campaign.id}.`);
      return { campaignId: campaign.id, actorUserId: actor.userId };
    });
    const progressBefore = await prisma.questObjectiveProgress.findMany({ orderBy: { id: 'asc' } });
    const backupDirectory = resolve('data/backups/player-quest-updates');
    await mkdir(backupDirectory, { recursive: true });
    const backup = resolve(backupDirectory, `${new Date().toISOString().replaceAll(':', '-')}.json`);
    await writeFile(backup, `${JSON.stringify({ objectives: before, progress: progressBefore }, null, 2)}\n`, 'utf8');
    const totals = { missions: 0, objectives: 0 };
    for (const scope of scopes) {
      const result = await enablePlayerQuestUpdates(scope);
      totals.missions += result.missions; totals.objectives += result.objectives;
    }
    const progressAfter = await prisma.questObjectiveProgress.findMany({ orderBy: { id: 'asc' } });
    if (JSON.stringify(progressBefore) !== JSON.stringify(progressAfter)) throw new Error('Progress changed concurrently; inspect the saved backup before continuing.');
    const remaining = await prisma.questObjective.count({ where: { playerEditable: false } });
    if (remaining) throw new Error(`${remaining} objectives still require updating.`);
    console.log(JSON.stringify({ ...totals, objectivesStillDisabled: remaining, progressPreserved: true, backup }));
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
