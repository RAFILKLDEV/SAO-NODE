# Modelo de domínio

## Conteúdo

`Entity` representa a identidade compartilhada de NPC, Location, Item, Monster e Quest. Guarda somente campos simples/extensíveis em `data`; itens que precisam de autorização, reconciliação ou consultas próprias ficam normalizados.

- `NarrativeField`: `key`, `value`, `visibility` por campo.
- `Reference`: destino por `targetType + targetDomainId`, `role` e `chance` opcional.
- `LocationConnection`: conexão permanente, acesso, distância e visibilidade.
- `MonsterComponent`: movimento, ataque, habilidade, perícia ou trait com ID e visibilidade próprios.
- `QuestObjective`: `objectiveId` permanente, dependências, segredo, visibilidade e `playerEditable`.
- `QuestReward`: recompensa extensível sem misturar progresso.

## Runtime

`QuestProgress` possui a chave lógica `questEntityId + ownerType + ownerId`. `QuestObjectiveProgress` guarda somente o valor runtime e o vínculo opcional com a definição atual. Quando um objetivo sai da definição, o runtime permanece com `orphaned=true`.

## Segurança

`Grant` implementa exceções persistentes de `allow`/`deny` para usuário ou grupo. O gate de existência usa `targetKind=entity` e `targetKey=existence`. Campos, objetivos, conexões e componentes usam chaves específicas.

A ordem de decisão adotada é: mestre sempre administra; grant individual explícito; deny de grupo; allow de grupo; visibilidade-base. Conteúdo `discoverable` não é público até haver allow. Objetivo marcado `secret` exige allow explícito para jogador mesmo quando a visibilidade-base for pública.

## Organização e T20

`Membership`, `Group` e `GroupMember` modelam acesso à campanha. `CharacterBinding` guarda modo, provider, externalId e snapshot. `NpcAssociation` é organizacional e não concede permissão.

O contrato `CharacterProvider` vive em `packages/domain`; o provider manual/local e o mock não tentam acessar APIs internas do Firecast.

## Dados derivados

Backlinks, nomes de referência, árvore de Locais, pesquisa e estados de conclusão são derivados. Não entram no XML externo.
