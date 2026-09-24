import { describe, expect, it } from 'vitest';
import { baseDiscoveryTargets, discoveryTargetKey, expandDiscoveryTargets, groupDiscoveryTargetsForDisplay, npcDiscoveryTargets } from './discoveryTargets.js';
import { buildBulkEntityDiscoveryRequest, buildDiscoveryGrantBatch } from '../pages/EntityPage.jsx';

describe('liberação de personagens', () => {
  it('oferece grupos fixos completos mesmo sem conteúdo', () => {
    const targets = npcDiscoveryTargets([{ id: 'npc.empty' }]);
    expect(targets.filter((target) => target.kind === 'group').map(({ label, targets }) => [label, targets.map(({ key }) => key)])).toEqual([
      ['Apresentação', ['shortDescription', 'description', 'appearance', 'section.identity']],
      ['Personalidade e história', ['personality', 'history']],
      ['Vínculos', ['section.locations', 'section.relations', 'section.references']],
      ['Serviços', ['section.services']],
      ['Ficha T20 e fichas adicionais', ['section.t20', 'section.extraStatBlocks']]
    ]);
    expect(targets.every((target) => !target.availableEntityIds)).toBe(true);
    expect(targets.filter((target) => target.kind === 'field').map(({ key }) => key)).toEqual([
      'section.basic', 'imageURL', 'gmNotes', 'section.additional', 'section.extensions'
    ]);
  });

  it('mantém campos personalizados separados e elimina chaves repetidas', () => {
    const targets = npcDiscoveryTargets([
      { fields: [{ key: 'rumor', value: '' }, { key: 'description', value: '' }] },
      { fields: [{ key: 'rumor', value: 'Texto' }, { key: 'gmNotes', value: '' }] }
    ]);
    expect(targets.filter(({ key }) => key === 'rumor')).toHaveLength(1);
    expect(targets.filter(({ key }) => key === 'description')).toHaveLength(0);
    const expanded = expandDiscoveryTargets([...targets, { kind: 'field', key: 'description' }]);
    expect(expanded.filter(({ key }) => key === 'description')).toHaveLength(1);
    expect(expanded.every(({ kind }) => kind !== 'group')).toBe(true);
  });

  it('agrupa campos em blocos de categoria para o modal de liberação', () => {
    const groups = groupDiscoveryTargetsForDisplay(buildBulkEntityDiscoveryRequest({ type: 'location', items: [{ id: 'loc.a', name: 'A', type: 'city', placement: { floor: '1' } }] }).categories)
      .filter((group) => group.kind === 'group');
    expect(groups.map((group) => group.label)).toEqual([
      'Identidade',
      'Ambiente e história',
      'Propósito do local',
      'Hierarquia',
      'Mapa e posição',
      'Organização da área',
      'Movimentação e conexões',
      'Serviços e economia',
      'Descanso e hospedagem',
      'Encontros e desafios',
      'Notas adicionais'
    ]);
    expect(groups[0].children.map((target) => target.key)).toEqual(['shortDescription', 'description']);
  });

  it('categoriza todos os campos extras conhecidos de local', () => {
    const targets = buildBulkEntityDiscoveryRequest({ type: 'location', items: [{
      id: 'loc.a', name: 'A', type: 'region', fields: [
        { key: 'andar', value: '1' }, { key: 'descanso', value: 'sim' },
        { key: 'dificuldade', value: 'alta' }, { key: 'organizacaoUrbana', value: 'grade' }
      ]
    }] }).categories;
    const groups = new Map(targets.filter((target) => target.kind === 'group').map((target) => [target.label, target.targets.map((item) => item.key)]));
    expect(groups.get('Hierarquia')).toContain('andar');
    expect(groups.get('Organização da área')).toContain('organizacaoUrbana');
    expect(groups.get('Descanso e hospedagem')).toContain('descanso');
    expect(groups.get('Encontros e desafios')).toContain('dificuldade');
  });

  it('mantém campos desconhecidos em uma categoria de fallback sem quebrar o request', () => {
    const targets = buildBulkEntityDiscoveryRequest({ type: 'location', items: [{
      id: 'loc.a', name: 'A', type: 'region', fields: [{ key: 'campoNovoDaCampanha', value: 'valor' }]
    }] }).categories;
    const fallback = targets.find((target) => target.label === 'Outros dados do cenário');
    expect(fallback?.targets.map((target) => target.key)).toContain('campoNovoDaCampanha');
  });

  it.each(['allow', 'deny'])('expande grupos para todos os selecionados, inclusive vazios (%s)', (allowance) => {
    const request = buildBulkEntityDiscoveryRequest({ type: 'npc', items: [
      { id: 'npc.a', name: 'A', fields: [{ key: 'description', value: 'Texto' }] },
      { id: 'npc.b', name: 'B' },
      { id: 'npc.c', name: 'Não selecionado' }
    ] });
    request.targets = npcDiscoveryTargets(request.entities);
    const grants = buildDiscoveryGrantBatch({
      request, selected: new Set(['player-a', 'player-b']),
      selectedEntities: new Set(['npc:npc.a', 'npc:npc.b']),
      selectedTargets: new Set([...baseDiscoveryTargets.map(discoveryTargetKey), 'group:presentation']),
      allowance
    });
    expect(grants).toHaveLength(28);
    for (const subjectId of ['player-a', 'player-b']) for (const entityId of ['npc.a', 'npc.b']) {
      expect(grants.filter((grant) => grant.subjectId === subjectId && grant.entityId === entityId).map(({ targetKey }) => targetKey)).toEqual([
        'existence', 'section.basic', 'imageURL', 'shortDescription', 'description', 'appearance', 'section.identity'
      ]);
    }
    expect(grants.every((grant) => grant.allowance === allowance && grant.targetKind !== 'group')).toBe(true);
    expect(grants.some((grant) => grant.targetKey === 'gmNotes' || grant.entityId === 'npc.c')).toBe(false);
  });
});
