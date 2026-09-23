import { describe, expect, it } from 'vitest';
import { buildDiff, exportSaoDataJson, parseSaoDataJson } from '../src/index.js';

const document = {
  schemaVersion: '1.0',
  packId: 'test.pack',
  name: 'Pacote de teste',
  language: 'pt-BR',
  presentContainers: ['monster', 'location'],
  entities: [
    { type: 'location', data: { id: 'loc.test.field', name: 'Campo', fields: [], references: [] } },
    { type: 'monster', data: { id: 'monster.test.boar', name: 'Javali', fields: [], references: [{ type: 'location', id: 'loc.test.field', role: 'found-in' }] } }
  ]
};

describe('saoData JSON', () => {
  it('parses, validates and exports a versioned document', () => {
    const parsed = parseSaoDataJson(JSON.stringify(document));
    expect(parsed.pack.entities).toHaveLength(2);
    expect(parsed.warnings).toEqual([]);
    expect(exportSaoDataJson(parsed.pack)).toMatchObject({ schemaVersion: '2.0', packId: 'test.pack' });
  });

  it('exports only the declared entity containers for a partial database export', () => {
    const exported = exportSaoDataJson({
      packId: 'test.monsters',
      name: 'Monstros',
      presentContainers: ['monster'],
      entities: [document.entities[1]]
    });

    expect(exported.containers).toEqual(['monster']);
    expect(exported.entities.map((entity) => entity.type)).toEqual(['monster']);
  });

  it('builds a selective diff with JSON removal status', () => {
    const { pack } = parseSaoDataJson(document);
    const diff = buildDiff([{ type: 'monster', id: 'monster.test.old', data: { id: 'monster.test.old' } }], pack);
    expect(diff.find((entry) => entry.id === 'monster.test.old')).toMatchObject({ status: 'REMOVED_FROM_JSON', selected: false });
  });

  it('rejects duplicate IDs', () => {
    expect(() => parseSaoDataJson({ ...document, entities: [...document.entities, document.entities[0]] })).toThrow(/duplicado/i);
  });
});
