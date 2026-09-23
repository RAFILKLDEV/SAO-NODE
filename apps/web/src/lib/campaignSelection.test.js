import { describe, expect, it } from 'vitest';
import { getCampaignSelectionDecision } from './campaignSelection.js';

describe('decisão de seleção de campanha', () => {
  it('não seleciona automaticamente quando o usuário tem mais de uma campanha', () => {
    const result = getCampaignSelectionDecision([
      { id: 'camp-1', name: 'Campanha A' },
      { id: 'camp-2', name: 'Campanha B' }
    ]);

    expect(result).toEqual({ autoSelect: false, mode: 'choose' });
  });

  it('seleciona automaticamente quando o usuário tem apenas uma campanha', () => {
    const result = getCampaignSelectionDecision([{ id: 'camp-1', name: 'Campanha A' }]);

    expect(result).toEqual({ autoSelect: true, mode: 'auto', campaignId: 'camp-1' });
  });
});
