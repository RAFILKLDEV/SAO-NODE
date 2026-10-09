import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildDiff, exportSaoDataJson, MAX_DEFAULT, parseSaoDataJson } from '../src/index.js';

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
  it('accepts monster packs larger than the old 5 MiB guard and preserves long sheets', () => {
    expect(MAX_DEFAULT).toBeGreaterThanOrEqual(100 * 1024 * 1024);
    const originalSheet = `Cabeçalho com espaços  \r\n\r\n${'Descrição longa. '.repeat(400_000)}\nFim`;
    const source = {
      schemaVersion: '2.0',
      packId: 'test.large-monsters',
      name: 'Monstros grandes',
      entities: [{
        type: 'monster',
        data: {
          id: 'monster.large',
          name: 'Colosso',
          visibility: {},
          fields: [{ key: 'originalSheet', value: originalSheet }],
          components: [{ id: 'ability-1', kind: 'ability', data: { name: 'Eco', description: originalSheet } }]
        }
      }]
    };

    expect(Buffer.byteLength(JSON.stringify(source), 'utf8')).toBeGreaterThan(5 * 1024 * 1024);
    const parsed = parseSaoDataJson(source);
    const monster = parsed.pack.entities[0].data;
    expect(monster.fields.find((field) => field.key === 'originalSheet')?.value).toBe(originalSheet);
    expect(monster.components[0].data.description).toBe(originalSheet);

    const exported = exportSaoDataJson(parsed.pack);
    const reparsed = parseSaoDataJson(exported).pack.entities[0].data;
    const roundTrip = reparsed.fields.find((field) => field.key === 'originalSheet')?.value;
    expect(roundTrip).toBe(originalSheet);
    expect(createHash('sha256').update(roundTrip, 'utf8').digest('hex'))
      .toBe(createHash('sha256').update(originalSheet, 'utf8').digest('hex'));
    expect(reparsed.components[0].data.description).toBe(originalSheet);
  });

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

  it('parses compact entity operations without declaring containers', () => {
    const parsed = parseSaoDataJson({
      schemaVersion: '2.0',
      packId: 'test.images',
      name: 'Atualizar imagens',
      operations: [
        {
          type: 'monster',
          id: 'monster.test.boar',
          set: { '/media/image': 'https://example.test/boar.gif' }
        }
      ]
    });

    expect(parsed.pack).toMatchObject({ containers: [], entities: [] });
    expect(parsed.pack.operations).toHaveLength(1);
    expect(() => buildDiff([], parsed.pack)).not.toThrow();
  });

  it('accepts the complete compact-operation envelope used in the AI guide', () => {
    const parsed = parseSaoDataJson({
      schemaVersion: '2.0',
      packId: 'alteracoes-campanha',
      name: 'Alterações da campanha',
      operations: [{
        type: 'monster', id: 'monster.lobo',
        set: { group: 'matilha' },
        add: { links: [{ type: 'item', id: 'item.carne', role: 'drops' }] },
        remove: {}
      }]
    });
    expect(parsed.pack.operations).toHaveLength(1);
    expect(() => parseSaoDataJson({ schemaVersion: '2.0', packId: 'p', name: 'n', operations: [{ type: 'monster', id: 'monster.lobo', set: {} }] })).not.toThrow();
  });

  it('extracts URLs from Markdown links in compact operations', () => {
    const { pack } = parseSaoDataJson({
      schemaVersion: '2.0',
      packId: 'test.images-markdown',
      name: 'Atualizar imagens',
      operations: [
        {
          type: 'monster',
          id: 'monster.test.boar',
          set: {
            '/media/image': '[Imagem](https://example.test/boar.gif)'
          }
        }
      ]
    });

    expect(pack.operations[0].set['/media/image']).toBe('https://example.test/boar.gif');
  });

  it('does not rewrite Markdown-looking source text in compact operations', () => {
    const source = '[Habilidade](https://example.test/book#section)\n  texto literal  ';
    const { pack } = parseSaoDataJson({
      schemaVersion: '2.0',
      packId: 'test.source-text',
      name: 'Texto original',
      operations: [{
        type: 'monster',
        id: 'monster.test.boar',
        set: { '/fields/0/value': source }
      }]
    });

    expect(pack.operations[0].set['/fields/0/value']).toBe(source);
  });

  it('repairs Markdown links split before a colon path segment', () => {
    const { pack } = parseSaoDataJson({
      schemaVersion: '2.0',
      packId: 'test.images-markdown-split',
      name: 'Atualizar imagens',
      operations: [
        {
          type: 'monster',
          id: 'monster.test.boar',
          set: {
            '/media/image': '[Imagem](https://example.test/wiki/Special):Redirect/file/Boar.gif'
          }
        }
      ]
    });

    expect(pack.operations[0].set['/media/image']).toBe(
      'https://example.test/wiki/Special:Redirect/file/Boar.gif'
    );
  });

  it('repairs Markdown links split around emphasis in a URL filename', () => {
    const { pack } = parseSaoDataJson({
      schemaVersion: '2.0',
      packId: 'test.images-markdown-emphasis',
      name: 'Atualizar imagens',
      operations: [
        {
          type: 'location',
          id: 'loc.test.field',
          set: {
            '/media/image': '[Imagem](https://example.test/3rd_Floor_-)*Dark_Elf_Base*-*Progressive.png'
          }
        }
      ]
    });

    expect(pack.operations[0].set['/media/image']).toBe(
      'https://example.test/3rd_Floor_-Dark_Elf_Base-Progressive.png'
    );
  });
});
