import { describe, expect, it } from 'vitest';
import { resolveApplySelection } from '../src/routes/json.js';

function previewOf(size = 300) {
  return {
    diff: Array.from({ length: size }, (_, index) => ({
      key: `monster:monster.${index + 1}`,
      status: 'NEW'
    })).concat([
      { key: 'monster:monster.equal', status: 'EQUAL' },
      { key: 'monster:monster.removed', status: 'REMOVED_FROM_JSON' }
    ])
  };
}

describe('seleção de importação', () => {
  it('seleciona globalmente 300 registros sem transportar 300 IDs', () => {
    const result = resolveApplySelection({ selectionMode: 'all' }, previewOf());
    expect(result.error).toBeUndefined();
    expect(result.selected.size).toBe(300);
    expect(result.selected.has('monster:monster.removed')).toBe(false);
  });

  it('permite exceções individuais depois da seleção global', () => {
    const result = resolveApplySelection({
      selectionMode: 'all',
      excludedKeys: ['monster:monster.7', 'monster:monster.101'],
      includedKeys: ['monster:monster.removed']
    }, previewOf());
    expect(result.selected.size).toBe(299);
    expect(result.selected.has('monster:monster.7')).toBe(false);
    expect(result.selected.has('monster:monster.101')).toBe(false);
    expect(result.selected.has('monster:monster.removed')).toBe(true);
  });

  it('mantém remoções fora da seleção global por padrão', () => {
    const result = resolveApplySelection({ selectionMode: 'all' }, previewOf());
    expect(result.selected.has('monster:monster.removed')).toBe(false);
  });
});
