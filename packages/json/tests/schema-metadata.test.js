import { describe, expect, it } from 'vitest';
import { saoDataJsonSchema, parseSaoDataJson } from '../src/index.js';
import { questTypeOptions } from '@sao/domain';

describe('vocabulários conhecidos no JSON Schema', () => {
  it('publica as opções de missão usadas no formulário com os rótulos', () => {
    const variants = saoDataJsonSchema().properties.entities.items.oneOf;
    const quest = variants.find((entry) => entry.properties.type.const === 'quest');
    const type = quest.properties.data.properties.type;
    expect(type.examples).toEqual(['main', 'side', 'daily', 'event']);
    expect(type['x-known-values']).toEqual(questTypeOptions);
    expect(type.description).toContain('daily (Diária)');
    expect(type.enum).toBeUndefined();
  });

  it.each(['daily', 'chain', 'personalizada'])('preserva o tipo %s na importação', (type) => {
    const { pack } = parseSaoDataJson(
      JSON.stringify({
        schemaVersion: '2.0',
        packId: 'test',
        name: 'Teste',
        entities: [{ type: 'quest', data: { id: 'quest.test', name: 'Teste', type } }]
      })
    );
    expect(pack.entities[0].data.type).toBe(type);
  });
});
