import { mkdir, writeFile } from 'node:fs/promises';
import { prisma } from '../apps/api/src/lib/prisma.js';
import { entityRecordToCanonical } from '../apps/api/src/services/content.js';

const folder = '.tmp/t20-player-allies';
try {
  const campaigns = await prisma.campaign.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const rows = await prisma.entity.findMany({
    where: { type: 'npc', deletedAt: null, data: { path: ['characterType'], equals: 'player' } },
    include: { fields: true, references: true }, orderBy: [{ campaignId: 'asc' }, { name: 'asc' }]
  });
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/before.json`, JSON.stringify(rows, null, 2), 'utf8');
  const report = rows.map(row => {
    const data = entityRecordToCanonical(row);
    return { pk: row.id, campaignId: row.campaignId, campaign: campaigns.find(campaign => campaign.id === row.campaignId)?.name, id: row.domainId, name: row.name, active: row.active, version: row.version, data };
  });
  await writeFile(`${folder}/characters.json`, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ campaigns, count: report.length, characters: report.map(row => ({ id: row.id, name: row.name, campaign: row.campaign, campaignId: row.campaignId, version: row.version, active: row.active, level: row.data.level, identity: row.data.identity, allyTypes: row.data.allyTypes, media: row.data.media, fields: row.data.fields.map(field => ({ key: field.key, value: String(field.value).slice(0, 1600) })) })) }, null, 2));
} finally { await prisma.$disconnect(); }
