import argon2 from 'argon2';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { parseSaoDataJson } from '@sao/json';
import { upsertImportedEntityTx } from '../src/services/content.js';

const prisma = new PrismaClient();
const root = new URL('../../../', import.meta.url);
const sampleUrl = new URL('examples/floor01.v2.sample.json', root);

try {
  const gmPassword = await argon2.hash('gm123');
  const playerPassword = await argon2.hash('player123');
  const adminPassword = await argon2.hash('asadasan123');
  const gm = await prisma.user.upsert({
    where: { login: 'gm' },
    create: { login: 'gm', name: 'Game Master', passwordHash: gmPassword },
    update: { name: 'Game Master', passwordHash: gmPassword }
  });
  const admin = await prisma.user.upsert({
    where: { login: 'Rafilkl' },
    create: { login: 'Rafilkl', name: 'Rafilkl', passwordHash: adminPassword },
    update: { name: 'Rafilkl', passwordHash: adminPassword }
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
    where: { campaignId_userId: { campaignId: campaign.id, userId: admin.id } },
    create: { campaignId: campaign.id, userId: admin.id, role: 'owner' },
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

  const json = await readFile(sampleUrl, 'utf8');
  const { pack } = parseSaoDataJson(json);
  const source = { kind: 'json', packId: pack.packId, fileName: 'floor01.sample.json', importedAt: new Date().toISOString() };
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

  console.log('Seed complete. GM: gm/gm123 | Admin: Rafilkl/asadasan123 | Player: player/player123');
} finally {
  await prisma.$disconnect();
}
