import argon2 from 'argon2';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { parseSaoData } from '@sao/xml';
import { upsertImportedEntityTx } from '../src/services/content.js';

const prisma = new PrismaClient();
const root = new URL('../../../', import.meta.url);
const sampleUrl = new URL('examples/floor01.sample.xml', root);
const xsdUrl = new URL('schemas/saoData-v1.xsd', root);

try {
  const gmPassword = await argon2.hash('gm123');
  const playerPassword = await argon2.hash('player123');
  const gm = await prisma.user.upsert({
    where: { login: 'gm' },
    create: { login: 'gm', name: 'Game Master', passwordHash: gmPassword },
    update: { name: 'Game Master', passwordHash: gmPassword }
  });
  const player = await prisma.user.upsert({
    where: { login: 'player' },
    create: { login: 'player', name: 'Jogador Demo', passwordHash: playerPassword },
    update: { name: 'Jogador Demo', passwordHash: playerPassword }
  });
  const campaign = await prisma.campaign.upsert({
    where: { slug: 'aincrad-demo' },
    create: { slug: 'aincrad-demo', name: 'Aincrad — Demonstração' },
    update: { name: 'Aincrad — Demonstração' }
  });
  await prisma.membership.upsert({
    where: { campaignId_userId: { campaignId: campaign.id, userId: gm.id } },
    create: { campaignId: campaign.id, userId: gm.id, role: 'owner' },
    update: { role: 'owner' }
  });
  await prisma.membership.upsert({
    where: { campaignId_userId: { campaignId: campaign.id, userId: player.id } },
    create: { campaignId: campaign.id, userId: player.id, role: 'player' },
    update: { role: 'player' }
  });
  await prisma.group.upsert({
    where: { campaignId_domainId: { campaignId: campaign.id, domainId: 'group.frontline' } },
    create: { campaignId: campaign.id, domainId: 'group.frontline', name: 'Linha de Frente' },
    update: { name: 'Linha de Frente' }
  });

  const xml = await readFile(sampleUrl, 'utf8');
  const xsd = await readFile(xsdUrl, 'utf8');
  const { pack } = await parseSaoData(xml, { xsd, fileName: 'floor01.sample.xml' });
  const source = { kind: 'seed', packId: pack.packId, fileName: 'floor01.sample.xml', importedAt: new Date().toISOString() };
  await prisma.$transaction(async (tx) => {
    for (const entity of pack.entities) {
      await upsertImportedEntityTx({ tx, campaignId: campaign.id, type: entity.type, input: entity.data, actorUserId: gm.id, source });
    }
  });

  // The demo quest is discoverable at entity level so the player initially cannot see it.
  await prisma.entity.update({
    where: { campaignId_type_domainId: { campaignId: campaign.id, type: 'quest', domainId: 'quest.f1.greenfields.boars' } },
    data: { baseVisibility: 'discoverable' }
  });

  console.log('Seed complete. GM: gm/gm123 | Player: player/player123');
} finally {
  await prisma.$disconnect();
}
