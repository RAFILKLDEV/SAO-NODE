import { PrismaClient } from '@prisma/client';
import { writeFile } from 'node:fs/promises';
import {
  contentInclude,
  planDataMigration,
  applyDataMigration
} from '../apps/api/src/services/dataMigration.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const backup = args.includes('--backup') ? args[args.indexOf('--backup') + 1] : undefined;
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : undefined;
if (apply && !backup)
  throw new Error(
    'Use --apply --backup arquivo.json para salvar o conteúdo original antes da migração'
  );
const prisma = new PrismaClient();
try {
  const rows = await prisma.entity.findMany({
    include: contentInclude,
    orderBy: [{ campaignId: 'asc' }, { type: 'asc' }, { domainId: 'asc' }]
  });
  const plan = planDataMigration(rows, {
    preserveAliasConflicts: args.includes('--preserve-alias-conflicts')
  });
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    total: plan.total,
    pending: plan.changes.length,
    errors: plan.errors,
    warnings: plan.warnings,
    diagnostics: plan.diagnostics
  };
  if (plan.errors.length) process.exitCode = 1;
  else if (apply) {
    const progress = await prisma.questProgress.findMany({ include: { objectives: true } });
    const grants = await prisma.grant.findMany();
    const audit = await prisma.auditLog.findMany();
    await writeFile(
      backup,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          schemaVersion: 'migration-backup-1',
          entities: rows,
          progress,
          grants,
          audit
        },
        null,
        2
      ),
      { flag: 'wx' }
    );
    Object.assign(
      report,
      await prisma.$transaction((tx) => applyDataMigration(tx, plan), {
        isolationLevel: 'Serializable',
        timeout: 120000
      })
    );
    report.backup = backup;
  }
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
