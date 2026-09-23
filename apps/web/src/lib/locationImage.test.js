import { describe, expect, it } from 'vitest';
import { normalizeEntity } from '@sao/domain';
import { createEntityDraft, draftControls, prepareCanonicalPayload, updateEntityDraft } from './entityDraft.js';
import { locationImageFileError, locationImageUrlError } from './locationImage.js';

describe('imagem do local', () => {
  it.each(['', ' https://example.com/image.png ', 'http://example.com/image', '/api/v1/campaigns/demo/media/abcd-1234.gif'])(
    'aceita imagem opcional ou endereço válido: %s', (url) => expect(locationImageUrlError(url)).toBe('')
  );
  it.each(['imagem.png', 'javascript:alert(1)', 'data:image/png;base64,abc', 'https://user:secret@example.com/image', '/other/image.png'])(
    'recusa endereço incompatível com o contrato: %s', (url) => expect(locationImageUrlError(url)).not.toBe('')
  );
  it('rejeita arquivos vazios ou formatos não aceitos, deixando o limite de tamanho para o servidor', () => {
    expect(locationImageFileError({ type: 'image/png', size: 0 })).not.toBe('');
    expect(locationImageFileError({ type: 'image/svg+xml', size: 80 })).not.toBe('');
    expect(locationImageFileError({ type: 'image/gif', size: 80 })).toBe('');
  });
  it.each(['https://example.com/new.png', ''])('salva troca/remoção preservando mapa, campos e vínculos: %s', (image) => {
    const original = normalizeEntity('location', {
      id: 'loc.city', name: 'Cidade', type: 'city',
      media: { image: 'https://example.com/old.png', map: 'https://example.com/map.png', source: 'https://example.com/source' },
      fields: [{ key: 'history', value: 'História secreta', visibility: 'gm' }],
      parentId: 'loc.region', connections: [], links: []
    });
    const draft = createEntityDraft('location', { schemaVersion: '2.0', data: original });
    const edited = updateEntityDraft('location', { ...draftControls('location', draft), subtitle: 'Novo subtítulo' });
    const saved = prepareCanonicalPayload('location', { ...edited, media: { ...edited.media, image } });
    expect(saved).toEqual({ ...original, subtitle: 'Novo subtítulo', media: { ...original.media, image } });
  });
});
