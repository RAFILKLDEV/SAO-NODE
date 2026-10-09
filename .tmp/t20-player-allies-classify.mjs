import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { prisma } from '../apps/api/src/lib/prisma.js';
import { config } from '../apps/api/src/lib/config.js';
import { audit } from '../apps/api/src/lib/audit.js';
import { entityRecordToCanonical } from '../apps/api/src/services/content.js';
import { normalizeEntity, t20AllyTypesSchema, formatT20Ally as t20AllyLabel } from '../packages/domain/src/index.js';

const folder = '.tmp/t20-player-allies';
const characters = JSON.parse(await readFile(`${folder}/characters.json`, 'utf8'));
const before = JSON.parse(await readFile(`${folder}/before.json`, 'utf8'));
// Interpretação das imagens examinadas e das informações existentes. Sem nível
// de parceiro comprovado, manter Iniciante; não inferir progressão pela imagem.
const choices = {
  'npc.alpharecoil': ['atirador', 'perseguidor', 'Rifle na imagem; caçador tático que observa o campo e seleciona alvos.'],
  'npc.blg-viper': ['ajudante', 'combatente', 'Espada e proteção funcional; guerreiro com foco em planejamento e preparação do grupo.'],
  'npc.donatelador': ['adepto', 'magivocador', 'A ficha informa Arcanista, conhecimento e habilidades poderosas; a espada da imagem não comprova especialização física.'],
  'npc.eletricraccon': ['ajudante', 'perseguidor', 'Equipamento leve na imagem; inventor e explorador com ferramentas, pesquisa e descoberta de áreas.'],
  'npc.gruntligeiro': ['combatente', 'vigilante', 'Visual sem armadura pesada; bucaneiro de ataques rápidos, mobilidade e iniciativa.'],
  'npc.honrado-com-amor': ['combatente', 'guardiao', 'Armadura e arma na imagem; paladino que atua na linha de frente e protege companheiros.'],
  'npc.loud-sininistra': ['ajudante', 'vigilante', 'Visual leve e marcante; bardo social e informante que acompanha rumores e percebe intenções.'],
  'npc.noobtownmayor': ['assassino', 'fortao', 'Ladino de equipamento leve; preservar os dois tipos já indicados na profissão, incluindo Fortão Iniciante.'],
  'npc.o-tal-do-mula': ['fortao', 'guardiao', 'Proteções na imagem; bárbaro descrito como resistente, com força e capacidade de continuar de pé.'],
  'npc.pablo-marcal-do-mal': ['ajudante', 'guardiao', 'Nobre negociador e influente; escudo e armadura na imagem fundamentam a função defensiva complementar.'],
  'npc.quebracraneo': ['combatente', 'fortao', 'Arma pesada na imagem; bárbaro agressivo que resolve combates com força bruta.'],
  'npc.thermaltank': ['combatente', 'guardiao', 'Armadura pesada; cavaleiro especializado em defesa e em segurar inimigos na linha de frente.'],
  'npc.tigeruppercut': ['combatente', 'fortao', 'Imagem sem arma pesada; lutador especializado em golpes físicos explosivos e combate corpo a corpo.']
};
const classification = characters.map(character => {
  const choice = choices[character.id];
  if (!choice) throw new Error(`Personagem sem classificação: ${character.id}`);
  const allyTypes = t20AllyTypesSchema.parse(choice.slice(0, 2).map(type => ({ type, rank: 'iniciante' })));
  if (allyTypes.length !== 2) throw new Error('Devem existir exatamente dois tipos');
  const canonical = normalizeEntity('npc', { ...character.data, allyTypes }, { format: '2.0' });
  if (!isDeepStrictEqual(canonical.allyTypes, allyTypes)) throw new Error('Tipos descartados pelo contrato');
  return { campaignId: character.campaignId, id: character.id, name: character.name, version: character.version, allyTypes, rationale: choice[2] };
});
await writeFile(`${folder}/classification.json`, JSON.stringify(classification, null, 2), 'utf8');
await writeFile(`${folder}/classification.md`, [
  '# Classificação dos personagens Jogador',
  '',
  'Fotos e fichas consultadas no banco atual. Grau Iniciante por falta de progressão de parceiro comprovada. NoobTownMayor mantém os tipos já indicados em profissão.',
  '',
  '| Personagem | Tipos | Motivo |',
  '| --- | --- | --- |',
  ...classification.map(row => `| ${row.name} | ${row.allyTypes.map(t20AllyLabel).join('; ')} | ${row.rationale} |`),
  ''
].join('\n'), 'utf8');

try {
  const actor = await prisma.user.findUnique({ where: { login: config.localAdminLogin }, select: { id: true, name: true } });
  if (!actor) throw new Error('Administrador local não encontrado');
  for (const campaignId of new Set(classification.map(row => row.campaignId))) {
    const membership = await prisma.membership.findUnique({ where: { campaignId_userId: { campaignId, userId: actor.id } } });
    if (!membership || !['owner', 'gm', 'assistant_gm'].includes(membership.role)) throw new Error('Administrador sem permissão na campanha');
  }
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ validated: classification.length, actor: actor.name, characters: classification.map(row => ({ name: row.name, types: row.allyTypes.map(t20AllyLabel) })) }, null, 2));
  } else {
    const saved = await prisma.$transaction(async tx => {
      const result = [];
      for (const row of classification) {
        const current = await tx.entity.findUnique({
          where: { campaignId_type_domainId: { campaignId: row.campaignId, type: 'npc', domainId: row.id } },
          include: { fields: true, references: true }
        });
        const original = before.find(entity => entity.id === current?.id);
        if (!current || !original || current.version !== row.version || current.deletedAt || current.data.characterType !== 'player') throw new Error(`Conflito de versão: ${row.id}`);
        if (!isDeepStrictEqual(JSON.parse(JSON.stringify(current)), original)) throw new Error(`Ficha alterada desde a análise: ${row.id}`);
        const data = { ...current.data, allyTypes: row.allyTypes };
        const updated = await tx.entity.updateMany({
          where: { id: current.id, campaignId: row.campaignId, type: 'npc', domainId: row.id, version: row.version, deletedAt: null },
          data: { data, localModifiedAt: new Date(), version: { increment: 1 } }
        });
        if (updated.count !== 1) throw new Error(`Conflito de versão: ${row.id}`);
        const after = await tx.entity.findUnique({ where: { id: current.id }, include: { fields: true, references: true } });
        const snapshot = entity => ({ data: entityRecordToCanonical(entity), source: entity.source ?? null, deletedAt: Boolean(entity.deletedAt) });
        const log = await audit(tx, { campaignId: row.campaignId, actorUserId: actor.id, action: 'entity.update', entityType: 'npc', entityDomainId: row.id, before: snapshot(current), after: snapshot(after), resultVersion: after.version });
        result.push({ id: row.id, name: row.name, version: after.version, auditId: log.id });
      }
      return result;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    await writeFile(`${folder}/saved.json`, JSON.stringify(saved, null, 2), 'utf8');
    console.log(JSON.stringify({ saved: saved.length, characters: saved }, null, 2));
  }
} catch (error) {
  console.error(error.code ?? 'CLASSIFICATION_FAILED', error.message);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
