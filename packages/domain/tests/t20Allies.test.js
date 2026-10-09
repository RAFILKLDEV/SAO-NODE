import { describe, expect, it } from 'vitest';
import { normalizeEntity, npcSchema, toLegacyEntity, t20AllyOptions, t20AllyBenefit, t20AllyTypes, sectionFields } from '../src/index.js';
import { exportSaoDataJson, parseSaoDataJson, saoDataJsonSchema } from '@sao/json';
import { createEntityDraft, draftControls, prepareCanonicalPayload, updateEntityDraft } from '../../../apps/web/src/lib/entityDraft.js';

const allies = [{ type: 'atirador', rank: 'veterano' }, { type: 'guardiao', rank: 'iniciante' }];

describe('Tormenta20 ally types', () => {
  it('offers every basic partner grade alphabetically with a mechanical description', () => {
    expect(t20AllyTypes).toHaveLength(12); expect(t20AllyOptions).toHaveLength(36);
    const labels = t20AllyOptions.map(option => option.label);
    expect(labels).toEqual([...labels].sort((first, second) => first.localeCompare(second, 'pt-BR')));
    for (const option of t20AllyOptions) expect(t20AllyBenefit(option)).toBeTruthy();
    expect(t20AllyBenefit({ type: 'atirador', rank: 'veterano' })).toContain('+1d10');
    expect(t20AllyBenefit({ type: 'atirador', rank: 'veterano' })).toContain('por rodada');
    expect(t20AllyBenefit({ type: 'magivocador', rank: 'mestre' })).toContain('+2 dados');
    expect(t20AllyBenefit({ type: 'destruidor', rank: 'veterano' })).toContain('4d6 por 2 PM');
    expect(t20AllyBenefit({ type: 'medico', rank: 'mestre' })).toContain('5 PM');
  });

  it.each(['npc', 'entity', 'player'])('preserves both roles in the %s character editor, v1/v2 and JSON export/import', characterType => {
    const entity = normalizeEntity('npc', { id: 'npc.partner', name: 'Parceiro', characterType, allyTypes: allies, visibility: { entity: 'discoverable', sections: { basic: 'discoverable' } } });
    expect(entity.allyTypes).toEqual(allies);
    const legacy = toLegacyEntity('npc', entity);
    expect(npcSchema.parse(legacy).allyTypes).toEqual(allies);
    expect(normalizeEntity('npc', legacy).allyTypes).toEqual(allies);
    const draft = createEntityDraft('npc', legacy), controls = draftControls('npc', draft);
    const saved = prepareCanonicalPayload('npc', updateEntityDraft('npc', { ...controls, name: 'Renomeado' }));
    expect(saved).toMatchObject({ name: 'Renomeado', characterType, allyTypes: allies, visibility: entity.visibility });
    const document = exportSaoDataJson({ schemaVersion: '2.0', packId: 'allies', name: 'Aliados', entities: [{ type: 'npc', data: saved }] });
    expect(parseSaoDataJson(document).pack.entities[0].data.allyTypes).toEqual(allies);
    expect(prepareCanonicalPayload('npc', updateEntityDraft('npc', { ...controls, allyTypes: [] })).allyTypes).toEqual([]);
  });

  it.each([
    [...allies, { type: 'medico', rank: 'mestre' }],
    [allies[0], { type: 'atirador', rank: 'mestre' }],
    [{ type: 'unknown', rank: 'iniciante' }],
    [{ type: 'atirador', rank: 'unknown' }],
    [{ type: 'atirador', rank: 'iniciante', description: 'Injected' }]
  ])('rejects excessive, duplicate or invalid roles (%j)', allyTypes => {
    for (const raw of [{ id: 'npc.x', name: 'X', allyTypes }, { id: 'npc.x', name: 'X', visibility: {}, allyTypes }]) expect(() => normalizeEntity('npc', raw)).toThrow();
    expect(() => npcSchema.parse({ id: 'npc.x', name: 'X', allyTypes })).toThrow();
  });

  it('leaves old records intact and exposes the field in the basic section and public schema', () => {
    expect(normalizeEntity('npc', { id: 'npc.old', name: 'Sem aliado', visibility: {} }).allyTypes).toBeUndefined();
    expect(sectionFields.npc.basic).toContain('allyTypes');
    const schema = saoDataJsonSchema().properties.entities.items.oneOf.find(entry => entry.properties.type.const === 'npc').properties.data;
    expect(schema.properties.allyTypes.maxItems).toBe(2);
    expect(schema.required).not.toContain('allyTypes');
  });
});
