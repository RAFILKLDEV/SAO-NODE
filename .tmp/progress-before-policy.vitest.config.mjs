import { defineConfig } from 'vitest/config';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
export default defineConfig({
  plugins: [{ name: 'restore-previous-progress-policy-in-memory', enforce: 'pre', transform(source, id) {
    const path = id.replaceAll('\\', '/');
    if (path.endsWith('/packages/domain/src/v2.js') || path.endsWith('/packages/domain/src/index.js')) {
      source = source.replace('playerEditable: z.boolean().default(true)', 'playerEditable: z.boolean().default(false)');
      source = source.replace('Boolean(objective && !objective.secret);', 'Boolean(objective && !objective.secret && objective.playerEditable);');
      return { code: source, map: null };
    }
    if (path.endsWith('/apps/api/src/routes/progress.js')) {
      source = source.replace("editable: progress.state === 'active' && !evaluation.objectives[entry.objectiveId]?.blocked", 'editable: Boolean(definition?.playerEditable) && !evaluation.objectives[entry.objectiveId]?.blocked');
      source = source.replace('if (!gm && !visibleQuest?.objectives.some(o => o.objectiveId === objective.objectiveId))', 'if (!gm && (!visibleQuest?.objectives.some(o => o.objectiveId === objective.objectiveId) || !objective.playerEditable))');
      return { code: source, map: null };
    }
  } }],
  test: { environment: 'node', include: ['apps/api/tests/data-v2.integration.test.js'] }
});
