# Análise do legado

## Escopo realmente disponível

A solicitação descreve os invariantes do SAO RPG Database e cita arquivos Lua/LFM, testes, XSD e XML que deveriam ser usados como fontes de verdade. Esses arquivos legados não foram fornecidos junto com o texto usado para esta implementação. Portanto, não foi possível fazer uma leitura comparativa real de `sao_db.lua`, `sao_progress.lua`, `sao_characters.lua`, `sao_discovery.lua`, `sao_xml.lua`, `forms/*.lfm` ou `__tests__/*.lua`.

Nesta árvore, o texto de requisitos foi tratado como contrato funcional. O projeto foi construído em pasta separada e não cria, altera nem apaga qualquer implementação Lua/LFM.

## Arquitetura inferida do sistema original

Pelos contratos descritos, o legado separa cinco famílias de conteúdo (NPC, Location, Item, Monster e Quest), runtime de progresso, descoberta/visibilidade, vínculos de personagem e serialização XML. IDs permanentes namespaced são a identidade canônica e referências guardam `type + id + role`, nunca uma cópia autoritativa de nome.

A migração web preserva essa separação: conteúdo autoritativo fica em `Entity` e tabelas filhas; runtime fica em `QuestProgress`; segurança em `Grant`; derivados (backlinks, árvore, resolução de nomes) são calculados; XML só contém conteúdo.

## Invariantes adotados

- unicidade por `campaignId + type + domainId`;
- `moduleId=br.sao.rpg.firecast.database` e `dataType=br.sao.rpg.database` preservados como compatibilidade;
- T20 atual `Ambesek.T20`, aceitando `Ambesek.Tormenta20` como alias legado;
- IDs de reimportação nunca são recriados;
- referências quebradas são mantidas;
- segredo é filtrado no servidor;
- grants não são permissões de frontend;
- progresso nunca é exportado no XML;
- reimportação de Quest reconcilia por `objectiveId` e mantém progresso órfão auditável;
- remoções de pacote são soft-delete para preservar runtime e referências.

## Risco de paridade

Sem os arquivos do legado citados no requisito, não é possível afirmar equivalência linha a linha, equivalência de todos os defaults, nomes de campos XML adicionais ou fidelidade visual aos `.lfm`. A arquitetura foi deliberadamente extensível para absorver essas diferenças sem trocar IDs ou destruir dados.
