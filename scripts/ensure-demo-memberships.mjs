import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const members = [
  { login: 'Fernando', name: 'Fernando', password: 'rafafofo', role: 'player' },
  { login: 'Rafilkl', name: 'Rafilkl', password: 'asadasan123', role: 'owner' }
];

try {
  for (const member of members) {
    const passwordHash = await argon2.hash(member.password);
    await prisma.user.upsert({
      where: { login: member.login },
      update: { name: member.name, passwordHash },
      create: { login: member.login, name: member.name, passwordHash }
    });
  }

  const campaign = await prisma.campaign.upsert({
    where: { slug: 'aincrad-demo' },
    update: { name: 'Aincrad — Demonstração' },
    create: { slug: 'aincrad-demo', name: 'Aincrad — Demonstração' }
  });

  for (const member of members) {
    const user = await prisma.user.findUnique({ where: { login: member.login } });
    const membership = await prisma.membership.upsert({
      where: { campaignId_userId: { campaignId: campaign.id, userId: user.id } },
      update: { role: member.role },
      create: { campaignId: campaign.id, userId: user.id, role: member.role }
    });
    console.log(`${member.login}: ${membership.role} => ${campaign.slug}`);
  }
} finally {
  await prisma.$disconnect();
}
