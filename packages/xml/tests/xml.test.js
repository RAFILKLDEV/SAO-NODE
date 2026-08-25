import { describe, expect, it } from 'vitest';
import { buildDiff, exportSaoData, parseSaoData } from '../src/index.js';

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<saoData schemaVersion="1.0" packId="aincrad.floor01.items" name="Itens" language="pt-BR">
  <items>
    <item id="item.f1.greenfields.healing-potion" name="Poção &amp; Cura" category="consumable" rarity="common" active="true">
      <value amount="25" currency="T$"/>
      <fields><field key="shortDescription" visibility="public">Recupera PV.</field></fields>
    </item>
  </items>
</saoData>`;

describe('saoData XML', () => {
  it('rejects DTD', async () => {
    await expect(parseSaoData('<!DOCTYPE x><saoData/>')).rejects.toThrow(/DTD/);
  });

  it('parses and exports UTF-8 safely', async () => {
    const { pack } = await parseSaoData(sample);
    expect(pack.entities[0].data.name).toBe('Poção & Cura');
    const xml = exportSaoData({ ...pack, entities: pack.entities });
    expect(xml).toContain('encoding="UTF-8"');
    expect(xml).toContain('Poção &amp; Cura');
  });

  it('handles NEW, ALTERED, EQUAL and removal only for present containers', async () => {
    const { pack } = await parseSaoData(sample);
    const equal = buildDiff([{ type: 'item', id: pack.entities[0].data.id, data: pack.entities[0].data }], pack);
    expect(equal[0].status).toBe('EQUAL');
    const changedPack = structuredClone(pack);
    changedPack.entities[0].data.name = 'Outra';
    expect(buildDiff([{ type: 'item', id: pack.entities[0].data.id, data: pack.entities[0].data }], changedPack)[0].status).toBe('ALTERED');
    const newDiff = buildDiff([], pack);
    expect(newDiff[0]).toMatchObject({ status: 'NEW', selected: true });
    const removalPack = { ...pack, entities: [] };
    const removal = buildDiff([{ type: 'item', id: 'item.f1.old', data: { id: 'item.f1.old' } }], removalPack);
    expect(removal[0]).toMatchObject({ status: 'REMOVED_FROM_XML', selected: false });
  });
});

it('round-trips supported item content without semantic loss', async () => {
  const first = await parseSaoData(sample);
  const xml = exportSaoData({ ...first.pack, entities: first.pack.entities });
  const second = await parseSaoData(xml);
  expect(second.pack.entities).toEqual(first.pack.entities);
});

it('does not treat absent containers as removals', async () => {
  const { pack } = await parseSaoData(sample);
  const diff = buildDiff([
    { type: 'item', id: pack.entities[0].data.id, data: pack.entities[0].data },
    { type: 'npc', id: 'npc.f1.keep', data: { id: 'npc.f1.keep', name: 'Keep' } }
  ], pack);
  expect(diff.some((entry) => entry.id === 'npc.f1.keep')).toBe(false);
});
