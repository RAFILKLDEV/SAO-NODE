import { describe, expect, it } from 'vitest';
import { normalizeEntity, buildTormenta20CriaturaXml } from '../src/index.js';

function extractTag(xml, name) {
  return xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? null;
}

function extractItems(xml, name) {
  const block = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
  return [...block.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
}

describe('buildTormenta20CriaturaXml', () => {
  it('converte um monstro completo do SAO-NODE no XML <criatura> esperado pelo Firecast', () => {
    const monster = normalizeEntity('monster', {
      id: 'monster.centauro-xama',
      name: 'Centauro Xamã',
      fields: [{ key: 'description', value: 'Centauro xamã, um humanoide grande com habilidades mágicas da natureza.' }],
      statBlocks: {
        default: {
          nd: '3',
          type: 'Humanoide',
          subtype: 'centauro',
          size: 'Grande',
          combat: { Defesa: '21' },
          resources: { Mana: '20', PV: '35' },
          resistances: { Fort: '+9', Ref: '+4', Von: '+15' },
          attributes: { FOR: '4', DES: '1', CON: '3', INT: '-1', SAB: '4', CAR: '0' }
        }
      },
      components: [
        { id: 'walk', kind: 'movement', data: { name: 'Caminhada', metros: '12m (8q)' } },
        { id: 'bordao', kind: 'attack', data: { name: 'Bordão', bonus: '+11', dano: '1d8+4', tipo: 'Corpo a Corpo' } },
        { id: 'cascos', kind: 'attack', data: { name: 'Cascos', bonus: '+11', dano: '1d8+4', tipo: 'Corpo a Corpo' } },
        { id: 'curar', kind: 'ability', data: { name: 'Curar Ferimentos', description: 'Uma criatura adjacente cura 4d8+4 PV.' } },
        { id: 'sobrevivencia', kind: 'skill', data: { name: 'Sobrevivência', bonus: '10' } },
        { id: 'percepcao', kind: 'trait', data: { name: 'Percepção Apurada' } },
        { id: 'imune-medo', kind: 'trait', data: { name: 'Imunidade a Medo' } },
        { id: 'resist-frio', kind: 'trait', data: { name: 'Resistência a Frio', valor: '5' } },
        { id: 'medo-altura', kind: 'trait', data: { name: 'Medo de Altura', descricao: 'Fica abalado perto de quedas.' } }
      ]
    }, { format: '2.0' });

    const xml = buildTormenta20CriaturaXml(monster);

    expect(extractTag(xml, 'nome')).toBe('Centauro Xamã');
    expect(extractTag(xml, 'nd')).toBe('3');
    expect(extractTag(xml, 'tipo')).toBe('Humanoide (centauro)');
    expect(extractTag(xml, 'tamanho')).toBe('Grande');
    expect(extractTag(xml, 'mana')).toBe('20');
    expect(extractTag(xml, 'pv')).toBe('35');
    expect(extractTag(xml, 'defesa')).toBe('21');
    expect(extractTag(xml, 'deslocamento')).toBe('Caminhada 12m (8q)');

    const atributos = extractTag(xml, 'atributos');
    expect(extractTag(atributos, 'for')).toBe('4');
    expect(extractTag(atributos, 'des')).toBe('1');
    expect(extractTag(atributos, 'con')).toBe('3');
    expect(extractTag(atributos, 'int')).toBe('-1');
    expect(extractTag(atributos, 'sab')).toBe('4');
    expect(extractTag(atributos, 'car')).toBe('0');

    const defesas = extractTag(xml, 'defesas');
    expect(extractTag(defesas, 'fort')).toBe('+9');
    expect(extractTag(defesas, 'ref')).toBe('+4');
    expect(extractTag(defesas, 'von')).toBe('+15');

    expect(extractItems(xml, 'pericias').join(',')).toContain('Sobrevivência +10');
    expect(extractItems(xml, 'sentidos')).toContain('Percepção Apurada');
    expect(extractItems(xml, 'imunidades')).toContain('Imunidade a Medo');
    expect(extractItems(xml, 'resistencias')).toContain('Resistência a Frio');

    const ataques = extractItems(xml, 'ataques');
    expect(ataques).toHaveLength(2);
    expect(extractTag(ataques[0], 'nome')).toBe('Bordão');
    expect(extractTag(ataques[0], 'bonus')).toBe('+11');
    expect(extractTag(ataques[0], 'dano')).toBe('1d8+4');
    expect(extractTag(ataques[0], 'quantidade')).toBe('1');

    const habilidades = extractItems(xml, 'habilidades');
    const habilidadeNomes = habilidades.map((item) => extractTag(item, 'nome'));
    expect(habilidadeNomes).toContain('Curar Ferimentos');
    // Trait sem categoria reconhecida (não é sentido/resistência/imunidade) vira habilidade extra.
    expect(habilidadeNomes).toContain('Medo de Altura');
  });

  it('preenche valores padrão seguros quando o monstro tem só o nome', () => {
    const monster = normalizeEntity('monster', {
      id: 'monster.minimo',
      name: 'Rato Gigante'
    }, { format: '2.0' });

    const xml = buildTormenta20CriaturaXml(monster);

    expect(extractTag(xml, 'nome')).toBe('Rato Gigante');
    expect(extractTag(xml, 'nd')).toBe('0');
    expect(extractTag(xml, 'tipo')).toBe('nenhum');
    expect(extractTag(xml, 'pv')).toBe('0');
    expect(extractTag(xml, 'defesa')).toBe('0');
    expect(extractTag(xml, 'deslocamento')).toBe('nenhum');
    expect(extractItems(xml, 'equipamentos')).toEqual(['nenhum']);
    expect(extractItems(xml, 'sentidos')).toEqual(['nenhum']);
    expect(extractItems(xml, 'resistencias')).toEqual(['nenhum']);
    expect(extractItems(xml, 'imunidades')).toEqual(['nenhum']);
    expect(xml).toContain('<criatura>');
    expect(xml).toContain('</criatura>');
  });

  it('escapa caracteres especiais de XML', () => {
    const monster = normalizeEntity('monster', {
      id: 'monster.perigoso',
      name: 'Dragão "Rei" & Cia <Lendário>'
    }, { format: '2.0' });

    const xml = buildTormenta20CriaturaXml(monster);
    expect(extractTag(xml, 'nome')).toBe('Dragão &quot;Rei&quot; &amp; Cia &lt;Lendário&gt;');
    expect(xml).not.toMatch(/<nome>[^<]*<Lendário>/);
  });
});
