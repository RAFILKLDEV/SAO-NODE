# Criar locais para SAO-NODE

Use `locais.schema.json` como contrato e `locais.exemplo.json` como exemplo importável. O schema foi extraído do gerador oficial `saoDataJsonSchema()` em 10/09/2026, mantendo apenas a variante de entidade `location` e limitando os containers a esse tipo. O contrato atual é saoData **2.0**. Não use as antigas instruções v1.

## Prompt para a IA

Crie a parte de locais da campanha descrita pelo usuário em JSON saoData 2.0, conforme o schema anexado. Retorne apenas o pacote JSON, sem comentários, Markdown ou propriedades de relatório. Use português brasileiro. Crie a hierarquia de regiões, cidades, distritos, edifícios e interiores necessária ao pedido, sem criar NPCs, monstros, itens ou missões adicionais. Use IDs `loc.` estáveis e preserve os IDs fornecidos. Declare `containers: ["location"]`. Use `parentId` para pertencimento e `connections` para deslocamento: são relações diferentes. Registre narrativa em `fields`, serviços em `services`, relações em `links` e dados adicionais de integração em `extensions`. Explicite a visibilidade da entidade e dos conteúdos. Não invente URLs de imagens nem IDs de entidades externas. Preserve distâncias plausíveis e crie a rota de retorno quando o caminho for bidirecional. Para caminhada comum, calcule `travelMinutes = Math.round(distanceKm * 1000 / 90)`, equivalente a 9 metros a cada 6 segundos. Tempos especiais precisam de justificativa narrativa. Siga também todas as regras adicionais abaixo, pois algumas são verificadas apenas pelo parser do backend.

## Envelope

| Campo | Tipo e regra |
|---|---|
| `schemaVersion` | Obrigatório: `"2.0"`. |
| `packId` | Texto não vazio; identificador estável do pacote. |
| `name` | Texto não vazio; nome do pacote. |
| `language` | Texto; padrão `"pt-BR"`. |
| `containers` | Opcional no backend; para esta entrega use `["location"]`. Não repetir valores. |
| `entities` | Array obrigatório de `{ "type": "location", "data": { ... } }`. |

Os containers participam do cálculo de remoções na comparação de importação. Um pacote parcial deve ser revisado no preview antes de aplicar.

## Todos os campos de `data`

Os únicos obrigatórios sem valor padrão são `id` e `name`. Opcionais devem ser omitidos quando desconhecidos; não preencher com `null`.

| Campo | Tipo / padrão | Uso |
|---|---|---|
| `id` | Texto não vazio | Prefixo `loc.` e sufixo não vazio; único no pacote. |
| `name` | Texto não vazio | Nome do local. |
| `subtitle` | Texto opcional | Subtítulo. |
| `active` | Booleano, `true` | Estado ativo. |
| `tags` | Array de textos não vazios, `[]` | Marcadores livres. |
| `discoveryRevision` | Inteiro ≥ 0, `0` | Revisão para controle de descoberta. |
| `visibility` | Objeto, `{ "sections": {} }` | `entity` opcional e `sections` como mapa de visibilidades. Valores: `public`, `gm`, `discoverable`. Seções usuais de locais: `basic` e `services`. Chaves do mapa são extensíveis, mas não criam novas seções funcionais automaticamente. |
| `media` | Objeto, `{}` | Campos opcionais `image`, `portrait`, `token`, `map`, `source`, todos textos de URL. |
| `fields` | Array, `[]` | Campos narrativos `{key, value, visibility}`. |
| `links` | Array, `[]` | Relações para entidades existentes. |
| `extensions` | Objeto JSON, `{}` | Dados específicos de integração, reservados ao mestre por padrão. Não representa funcionalidade automática. |
| `type` | Texto não vazio, `region` | Categoria do local; não confundir com `entities[].type`, que é sempre `location`. |
| `state` | Texto opcional | Estado do local. |
| `parentId` | Texto não vazio opcional | ID `loc.` do local pai. Omitir nas raízes; não usar string vazia. |
| `placement` | Objeto, `{}` | `floor` opcional, texto ou número; identifica andar/pavimento sem exigir entidade de andar. |
| `environment` | Texto opcional | Ambiente. |
| `recommendedLevel` | Texto ou número opcional | Nível ou faixa de níveis. |
| `services` | Array, `[]` | `{name, description}`; nome não vazio obrigatório, descrição textual com padrão vazio. |
| `connections` | Array, `[]` | Rotas detalhadas abaixo. |

Categorias conhecidas: `region`, `city`, `district`, `bank`, `market`, `workshop`, `plaza`, `government`, `storage`, `temple`, `inn`, `shop`, `residence`, `building`, `floor`, `dungeon`, `room`, `landmark`. Aceita categorias personalizadas.

Estados conhecidos: `safe`, `dangerous`, `unknown`, `blocked`. Aceita estados personalizados.

URLs aceitam HTTP/HTTPS sem credenciais, string vazia ou mídia interna no formato `/api/v1/campaigns/<campanha>/media/<nome>.<extensão>`, com nome composto de caracteres hexadecimais e hífens; extensões png, jpg, jpeg, gif, webp, avif ou bmp. Prefira omitir imagens inexistentes. A validação fina de URL é feita pelo backend.

## Campos narrativos

Cada entrada de `fields` possui `key` (texto não vazio, único na entidade), `value` (texto obrigatório) e `visibility` (padrão `public`; valores `public`, `gm`, `discoverable`).

Sugestões de chaves, não campos fixos do contrato: `descricao`, `aparencia`, `historia`, `atmosfera`, `pontos_de_interesse`, `perigos`, `recursos`, `regras_locais`, `rumores`, `segredos`, `condicoes_de_viagem`. Use `gm` para segredos e informações do mestre. Não acrescente `description`, `history`, `dangerLevel` ou outros campos desconhecidos diretamente em `data`.

## Links

| Campo | Regra |
|---|---|
| `type` | Obrigatório: `npc`, `location`, `item`, `monster` ou `quest`. |
| `id` | Obrigatório; prefixo correspondente `npc.`, `loc.`, `item.`, `monster.` ou `quest.`. |
| `role` | Texto não vazio; padrão `related`; aceita relações personalizadas. |
| `slot` | Para locais use somente `references`, que é o padrão. |
| `chance` | Opcional; percentual inteiro de 1 a 100. |
| `quantityMin` | Opcional; inteiro positivo. |
| `quantityMax` | Opcional; inteiro positivo, não menor que o mínimo. |

Não repetir a combinação `type + id + role + slot`. Referências externas ausentes do pacote geram avisos; são permitidas para pacotes parciais. Só referencie registros conhecidos, fornecidos pelo usuário ou presentes no catálogo.

## Conexões

| Campo | Regra |
|---|---|
| `id` | Texto não vazio obrigatório; estável e único dentro do local. Não há prefixo obrigatório para este ID. |
| `target` | Obrigatório: `{ "type": "location", "id": "loc.destino" }`. |
| `type` | Texto opcional; tipo narrativo da rota. |
| `direction` | Texto opcional; direção narrativa, sem enum fechado. |
| `distanceKm` | Número ≥ 0 opcional; quilômetros, incluindo frações. |
| `travelMinutes` | Inteiro ≥ 0 opcional; se omitido e houver distância, o backend calcula o tempo de caminhada. |
| `access` | `public`, `discoverable`, `hidden`, `conditional`, `blocked`; padrão `public`. |
| `unlockCondition` | Texto opcional; descreva a condição de acesso quando pertinente. |
| `visibility` | `public`, `gm`, `discoverable`; padrão `public`. |

`access` e `visibility` são diferentes: `hidden` é válido apenas em `access`. Uma rota pode ser visível e estar bloqueada. Não presuma criação automática da conexão inversa. Em caminhada comum, 0,45 km corresponde a 5 minutos; 0,15 km corresponde a 1 min 40 s, arredondado para 2 minutos. Não crie `travelSeconds`; registre precisão adicional em `fields` quando necessário.

## Regras adicionais e validação

- Não usar chaves v1: `baseVisibility`, `sectionVisibility`, `references`, `imageURL`, `imageUrl`, `mapUrl`, `levelRecommended`, `connectionId`, `targetId`, `to`, `presentContainers`.
- Na v2, `visibility.entity` pode controlar a visibilidade da entidade. Entidade nova sem esse campo fica `gm`; atualização sem o campo preserva a política existente. Explicite a intenção na criação.
- A árvore de `parentId` não pode ter ciclos nem autorreferências. Conexões de ida e volta são permitidas; não são ciclos de hierarquia.
- Não repetir IDs de entidades, chaves de fields ou IDs de conexões dentro da mesma entidade.
- Propriedades desconhecidas são rejeitadas fora de objetos explicitamente extensíveis.
- O JSON Schema é a projeção oficial dos schemas Zod. Regras relacionais, namespaces, URLs refinadas e restrições entre campos exigem o parser real; validar apenas com JSON Schema não basta.
- Rode `npm run data:validate -- caminho/do/pacote.json`. Para expansão de catálogo, acrescente `--catalog caminho/do/catalogo.json`.
- A validação do exemplo comprova aceitação pelo parser e estabilidade da normalização; não comprova importação no banco.

Fontes: `packages/domain/src/v2.js`, `packages/domain/src/entityMetadata.js`, `packages/json/src/index.js` e `docs/schemas-explicados.md`.
