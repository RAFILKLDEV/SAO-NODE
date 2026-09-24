import { expect, it } from 'vitest';
import { buildBulkEntityDiscoveryRequest, buildDiscoveryGrantBatch } from '../pages/EntityPage.jsx';

it.each([['location', 'connections'], ['monster', 'abilities'], ['item', 'stats']])('preserves empty %s categories through modal opening and submits them', (type, section) => {
  const request = { ...buildBulkEntityDiscoveryRequest({ type, items: [{ id: `${type}.empty`, name: 'Empty' }] }) };
  expect(request.targets.some((target) => target.key === section)).toBe(true);
  const grants = buildDiscoveryGrantBatch({ request,
    selected: new Set(['player']), selectedEntities: new Set([`${type}:${type}.empty`]),
    selectedTargets: new Set([`group:${section}`]), allowance: 'allow'
  });
  expect(grants).toContainEqual({ subjectType: 'user', subjectId: 'player', entityType: type,
    entityId: `${type}.empty`, targetKind: 'field', targetKey: `section.${section}`, allowance: 'allow' });
});
