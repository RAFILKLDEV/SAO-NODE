import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const passwordHash = await argon2.hash('rafafofo');
  const user = await prisma.user.upsert({
    where: { login: 'Fernando' },
    update: { name: 'Fernando', passwordHash },
    create: { login: 'Fernando', name: 'Fernando', passwordHash }
  });

  console.log(JSON.stringify({
    id: user.id,
    login: user.login,
    name: user.name
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
