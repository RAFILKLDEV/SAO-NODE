import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const passwordHash = await argon2.hash('asadasan123');
  const user = await prisma.user.upsert({
    where: { login: 'Rafilkl' },
    update: { name: 'Rafilkl', passwordHash },
    create: { login: 'Rafilkl', name: 'Rafilkl', passwordHash }
  });

  console.log(JSON.stringify({
    id: user.id,
    login: user.login,
    name: user.name
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
