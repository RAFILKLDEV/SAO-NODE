# Schemas do SAO-NODE explicados

Este documento descreve o contrato de conteúdo **saoData v2** usado na importação e exportação (`schemas/saoData-v2.schema.json`). A implementação executável fica em `packages/domain/src/v2.js`; portanto, ela também aplica regras que um JSON Schema não consegue expressar, como ciclos, IDs duplicados e referências.

## 1. Envelope do pacote

Um arquivo é um objeto com:

| Campo | Tipo | Obrigatório | Função |
|---|---|---:|---|
| `schemaVersion` | string | sim | Versão do contrato. Deve ser exatamente `"2.0"`. Arquivos `"1.0"` são migrados para v2 na entrada. |
| `packId` | string | sim | Identificador estável do pacote, usado em importação, histórico e diff. |
| `name` | string | sim | Nome humano do pacote. |
| `language` | string | não | Idioma dos textos, por exemplo `pt-BR`; padrão `pt-BR`. |
| `containers` | array de `npc`, `location`, `item`, `monster`, `quest` | não | Tipos que o pacote controla. Se omitido, é derivado dos tipos presentes. Um tipo declarado participa do cálculo de remoções no diff. |
| `entities` | array | sim | Registros `{ type, data }`. `type` identifica o schema e `data` contém a ficha. |

`containers` não pode repetir valores e toda entidade precisa pertencer a um container declarado. O pacote não aceita propriedades desconhecidas no envelope nem nas fichas; coloque extensões em `data.extensions`.

## 2. Campos comuns a todas as entidades

Todos os cinco tipos começam com estes campos:

| Campo | Tipo/padrão | Explicação |
|---|---|---|
| `id` | string | ID permanente. O prefixo depende do tipo: `npc.`, `loc.`, `item.`, `monster.` ou `quest.`. O sufixo não pode ser vazio. |
| `name` | string | Nome exibido e usado para busca. |
| `subtitle` | string opcional | Título secundário, categoria curta ou epíteto. |
| `active` | booleano, `true` | Controla se o conteúdo está ativo. |
| `tags` | string[], `[]` | Marcadores livres; cada marcador deve ser não vazio. |
| `discoveryRevision` | inteiro ≥ 0, `0` | Número da revisão de descoberta. Permite invalidar o estado de descoberta dos jogadores quando o conteúdo muda. |
| `visibility` | objeto, `{sections:{}}` | Política de acesso (ver abaixo). |
| `media` | objeto, `{}` | URLs de `image`, `portrait`, `token`, `map` e `source`. Aceita HTTP/HTTPS sem usuário ou senha, ou URL interna `/api/v1/.../media/...`. |
| `fields` | array, `[]` | Campos narrativos extensíveis: `{key, value, visibility}`. `key` é único dentro da entidade; `value` é texto. |
| `links` | array, `[]` | Relações para outras entidades, sem duplicar o registro de destino. |
| `extensions` | objeto JSON, `{}` | Dados adicionais específicos de uma integração. É conteúdo de mestre por padrão; campos desconhecidos fora daqui são rejeitados. |

`visibility.entity` e `visibility.sections.*` aceitam `public` (todos), `gm` (mestre) ou `discoverable` (aparece depois de descoberta). A visibilidade de uma seção é independente da visibilidade da entidade. `fields[].visibility` e componentes/objetivos/conexões também usam esses três valores.

### Links e destinos

Um link é `{type, id, role, slot?, chance?, quantityMin?, quantityMax?}`. `type` é um dos cinco tipos e `id` precisa usar o namespace correspondente. `role` descreve a relação e por padrão é `related`. `slot` é `references` por padrão; `locations` e `relations` são reservados para NPCs. `chance` é percentual inteiro de 1 a 100. `quantityMin`/`quantityMax` são quantidades inteiras positivas e o máximo não pode ser menor que o mínimo. Para drops de item, use `role: "drops"`.

Um destino sempre tem a forma `{type, id}`. A ausência do destino no pacote gera aviso de referência não resolvida, mas não invalida um pacote parcial.

## 3. NPC (`type: "npc"`)

Além dos campos comuns:

| Campo | Tipo/padrão | Explicação |
|---|---|---|
| `identity` | objeto, `{}` | `race`, `gender`, `age` (texto ou número) e `profession`. |
| `level` | texto ou número opcional | Nível do NPC. |
| `factions` | string[], `[]` | IDs ou nomes de facções. |
| `services` | array, `[]` | Serviços oferecidos; cada item é `{name, description}` e `description` tem padrão vazio. |
| `character` | objeto opcional | Vínculo de ficha externa: `mode` (`none`, `embedded`, `linked`), `providerId` (padrão `Ambesek.T20`), `externalId`, `uri` e `snapshot` JSON opcional. |

## 4. Local (`type: "location"`)

| Campo | Tipo/padrão | Explicação |
|---|---|---|
| `type` | string, `region` | Categoria do local (cidade, masmorra etc.). |
| `state` | string opcional | Estado narrativo ou de disponibilidade. |
| `parentId` | ID de `location` opcional | Local pai. A hierarquia não pode conter ciclos e um local não pode ser seu próprio pai. |
| `placement` | `{floor?}`, `{}` | Andar/pavimento; `floor` aceita texto ou número. |
| `environment` | string opcional | Ambiente (floresta, urbano etc.). |
| `recommendedLevel` | texto ou número opcional | Nível recomendado. |
| `services` | array, `[]` | Serviços disponíveis no local, usando `{name, description}`. |
| `connections` | array, `[]` | Rotas para outros locais (ver abaixo). |

Uma conexão é `{id, target, type?, direction?, distanceKm?, travelMinutes?, access, unlockCondition?, visibility}`. `target.type` deve ser `location`; `id` da conexão é único no local. `distanceKm` é número não negativo. `travelMinutes` é inteiro não negativo; se omitido, é calculado como `round(distanceKm * 1000 / 90)`. `access` aceita `public`, `discoverable`, `hidden`, `conditional` ou `blocked`. `unlockCondition` explica a condição quando o acesso é condicional.

## 5. Item (`type: "item"`)

| Campo | Tipo/padrão | Explicação |
|---|---|---|
| `category` | string, `misc` | Categoria do item. |
| `rarity` | string, `common` | Raridade. |
| `value` | `{amount, currency}` opcional | Preço/valor. `amount` aceita texto ou número; `currency` é texto não vazio. |
| `stats` | array, `[]` | Modificadores `{key, value, operation?}`. `value` pode ser string, número ou booleano; `operation` é texto livre (por exemplo `add` ou `multiply`). `key` é único. |

## 6. Monstro (`type: "monster"`)

| Campo | Tipo/padrão | Explicação |
|---|---|---|
| `group` | string opcional | Grupo ou família do monstro. |
| `statBlocks` | objeto, `{}` | Fichas separadas por sistema. A chave recomendada para T20 é `Ambesek.T20`; o alias legado `Ambesek.Tormenta20` é convertido. |
| `components` | array, `[]` | Movimentos, ataques, habilidades, perícias e traços. |

Cada `statBlocks[provider]` contém `nd?`, `type?`, `subtype?`, `size?`, e os mapas `combat`, `resources`, `resistances`, `attributes` (todos padrão `{}`), além de `statsVisibility` (mapa `campo -> public|gm|discoverable`). Os mapas preservam os atributos do sistema sem impor uma lista fixa.

Cada componente é `{id, kind, visibility, data}`. `kind` é `movement`, `attack`, `ability`, `skill` ou `trait`; `data` é um objeto JSON livre; `id` é único dentro do mesmo `kind`.

## 7. Missão (`type: "quest"`)

| Campo | Tipo/padrão | Explicação |
|---|---|---|
| `type` | string, `side` | Tipo da missão. |
| `state` | string, `available` | Estado narrativo. |
| `briefing` | string opcional | Texto apresentado no início. |
| `completionText` | string opcional | Texto ao concluir. |
| `recommendedLevel` | texto ou número opcional | Nível recomendado. |
| `startSource` | destino opcional | Entidade que inicia a missão. |
| `completionReceiver` | destino opcional | Entidade que recebe a conclusão. |
| `prerequisites` | IDs de quests, `[]` | Missões necessárias antes desta. O grafo não pode ter ciclos. |
| `requirements` | array, `[]` | Requisitos `{type, id?, minimum?, quantity?, state?}`. `id` é usado quando `type` é um tipo de entidade. |
| `nextQuests` | IDs de quests, `[]` | Missões liberadas depois. |
| `requirementLogic` | `all` ou `any`, `all` | Se todos ou qualquer requisito deve ser atendido. |
| `objectiveMode` | `ordered` ou `free`, `free` | Em `ordered`, objetivos obrigatórios anteriores bloqueiam os seguintes; em `free`, dependem apenas de `dependsOn`. |
| `objectives` | array, `[]` | Objetivos (ver abaixo). |
| `rewards` | array, `[]` | Recompensas (ver abaixo). |
| `timeLimitMinutes` | inteiro positivo opcional | Limite de tempo da missão. |

Objetivo: `{objectiveId, type, text, order, requiredQuantity, optional, secret, visibility, target?, dependsOn, playerEditable}`. `objectiveId` é estável e único; `order` é inteiro ≥ 0; `requiredQuantity` é inteiro positivo (padrão 1); `optional`, `secret` e `playerEditable` são booleanos (padrão `false`); `dependsOn` lista IDs existentes na mesma missão (padrão `[]`) e não pode formar ciclo. `secret` oculta o objetivo do jogador; `playerEditable` permite que o jogador atualize seu progresso quando o objetivo não é secreto.

Recompensa: `{rewardId, type, target?, amount?, quantity?, currency?, choiceGroup?, data?}`. `rewardId` é único e estável. `target` aponta para a entidade recompensada; os demais campos representam valor, quantidade, moeda, grupo de escolha e dados específicos.

## 8. Normalização, importação e erros

O parser preenche defaults, ordena coleções de forma estável e sempre devolve v2. IDs de entidades são únicos no pacote. Ele rejeita propriedades desconhecidas, namespaces incompatíveis, duplicações de `fields`, `links`, `stats`, `connections`, `components`, `objectives` e `rewards`, ciclos de locais/pré-requisitos/objetivos e quantidades inválidas. Referências ausentes são avisos para permitir pacotes parciais. Um registro novo sem `visibility.entity` fica `gm`; uma atualização sem esse campo mantém a política existente.

Valide um pacote com:

```powershell
npm run data:validate -- examples/floor01.v2.sample.json
```

## Fontes do contrato

- [JSON Schema executável](../schemas/saoData-v2.schema.json)
- [Schemas e regras Zod v2](../packages/domain/src/v2.js)
- [Parser e envelope JSON](../packages/json/src/index.js)
- [Exemplo completo](../examples/saoData-v2.template.json)
