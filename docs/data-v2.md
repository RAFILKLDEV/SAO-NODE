# Estrutura de dados saoData v2

O contrato executável está em `packages/domain/src/v2.js`. CRUD, importação, seed e migração usam o mesmo normalizador. `packages/json` cuida do envelope, conversão de pacotes, diff e exportação. Os rótulos e as seções compartilhados ficam em `packages/domain/src/entityMetadata.js`.

A aplicação local e os testes estão registrados em [data-v2-validation.md](data-v2-validation.md).

## Documento canônico

```json
{
  "schemaVersion": "2.0",
  "packId": "minha-campanha",
  "name": "Minha campanha",
  "language": "pt-BR",
  "containers": ["location"],
  "entities": [{
    "type": "location",
    "data": {
      "id": "loc.porto",
      "name": "Porto",
      "type": "city",
      "placement": { "floor": "1" },
      "visibility": { "entity": "gm", "sections": {} }
    }
  }]
}
```

O normalizador preenche coleções vazias e defaults. Campos desconhecidos no v2 são erros; dados adicionais devem ficar em `extensions`, que é conteúdo de GM por padrão. Cada pacote pode conter somente alguns tipos; `containers` define quais tipos participam do diff de remoções. Sua omissão deriva os tipos presentes nas entidades.

## Operações compactas

Para alterar campos de entidades já existentes sem reenviar a ficha completa, a importação também aceita um envelope `operations`. Cada alvo aparece uma única vez e usa os mesmos comandos `set`, `add` e `remove` do `PATCH` de entidade.

```json
{
  "schemaVersion": "2.0",
  "packId": "imagens.monstros",
  "name": "Atualizar imagens",
  "operations": [
    {
      "type": "monster",
      "id": "monster.burafonte",
      "set": {
        "/media/image": "https://www.tibiawiki.com.br/images/e/e3/Armadile.gif"
      }
    }
  ]
}
```

As operações são aplicadas sobre o estado atual para gerar a prévia, validar o resultado e preservar todos os campos omitidos. Elas só atualizam entidades existentes, não declaram `containers` e nunca geram `REMOVED_FROM_JSON`; a prévia continua permitindo selecionar os alvos antes da transação final.

Valores URL em `set`, `add` e `remove` aceitam tanto a URL pura quanto um link Markdown completo, como `[Imagem](https://exemplo.com/imagem.gif)`. O importador extrai e armazena somente a URL de destino. Também corrige URLs cortadas por Markdown quando um segmento fica após o link, incluindo `[Imagem](https://exemplo.com/wiki/Special):Redirect/file/imagem.gif` e trechos com ênfase, como `[Imagem](https://exemplo.com/arquivo-)*nome*.png`.

| Entidade | Estrutura específica | Namespace |
| --- | --- | --- |
| NPC | `identity`, `services`, `factions`, `character` | `npc.` |
| Local | `parentId`, `placement.floor`, `connections` | `loc.` |
| Item | `value: {amount, currency}`, `stats: [{key, value, operation?}]` | `item.` |
| Monstro | `statBlocks` por sistema, `components: [{id, kind, visibility, data}]` | `monster.` |
| Missão | objetivos, requisitos, fluxo e recompensas | `quest.` |

Todos compartilham `id`, `name`, `subtitle?`, `active`, `tags`, `discoveryRevision`, `visibility`, `media`, `fields`, `links` e `extensions`. Mídia usa as chaves `image`, `portrait`, `token`, `map` e `source`.

`links` guarda relações gerais como `{type, id, role, slot}`. O slot padrão é `references`; NPCs também usam `locations` e `relations`, preservando as permissões das seções anteriores. Drops acrescentam `chance`, `quantityMin` e `quantityMax`. Destinos de conexões, objetivos e recompensas permanecem nos próprios registros e geram referências de leitura; não são duplicados na tabela `Reference`.

Conexões têm `id`, `target: {type: "location", id}`, `type?`, `direction?`, `distanceKm?`, `travelMinutes?`, `access`, `visibility` e `unlockCondition?`. Sem tempo explícito, a distância gera minutos usando 90 m/min. `parentId` aceita qualquer hierarquia sem ciclos. A navegação herda o andar do ancestral; somente o adaptador v1 interpreta convenções antigas de tags/IDs.

Monstros usam `statBlocks["Ambesek.T20"]` para a ficha anterior, mantendo outros sistemas separados. NPCs usam `character: {mode, providerId, externalId, uri, snapshot}`; snapshots aceitam JSON para preservar propriedades de integrações externas.

Objetivos exigem `objectiveId` e `order`, com `dependsOn` referindo IDs existentes na mesma missão. Recompensas exigem `rewardId` e admitem `target`, `amount`, `quantity`, `currency`, `choiceGroup` e `data`. Mantenha esses IDs ao editar ou reordenar. Duplicações, namespaces incompatíveis e ciclos são erros. Destinos ausentes no catálogo geram avisos para permitir pacotes parciais.

## Permissões e API

- Entidade nova sem `visibility.entity`: fica `gm`.
- Atualização sem `visibility.entity`: mantém a política existente.
- Visibilidade explícita: aparece no diff e muda somente ao selecionar aquela entidade.
- Grants e runtime continuam no banco e não são substituídos pelo pacote.
- Respostas de jogador são filtradas no servidor, inclusive backlinks e progresso de objetivos ocultos.

Os caminhos HTTP permanecem em `/api/v1`. Leitura de entidade com `?format=2` retorna `{schemaVersion, entityType, id, name, version, createdAt, updatedAt, backlinks, data}`; o editor busca esse formato antes de editar. A leitura padrão mantém a projeção v1 durante a transição. Uma resposta filtrada de jogador pode omitir conteúdo obrigatório: use a exportação de GM para obter um pacote completo.

| Operação | Caminho relativo à campanha |
| --- | --- |
| Modelo v2 | `GET import/template` |
| JSON Schema gerado | `GET import/schema` |
| Prévia v1 ou v2 | `POST import/preview` |
| Aplicar seleção | `POST import/apply` |
| Exportar v2 | `GET export.json` |
| Exportar compatibilidade v1 | `GET export.json?format=1` |

A prévia registra versões e expira após 15 minutos. Aplicar uma prévia desatualizada retorna 409; a seleção final é validada dentro de uma transação serializável. `REMOVED_FROM_JSON` começa desmarcado e, quando selecionado, aplica soft-delete. Objetivos removidos deixam progresso órfão preservado; recuperar o mesmo `objectiveId` reconecta esse progresso.

## Compatibilidade e artefatos

O parser aceita v1 e sempre devolve v2. Aliases só existem nessa fronteira. Valores incompatíveis bloqueiam a conversão padrão. Campos legados sem correspondência são preservados em `extensions.legacy` ou `extensions.legacyNested`, acompanhados de diagnósticos. IDs de filhos existentes são preservados; filhos v1 sem ID recebem uma identidade determinística. Colisões não são renumeradas silenciosamente.

- [Modelo completo dos cinco tipos](../examples/saoData-v2.template.json)
- [Pacote demonstrativo v2](../examples/floor01.v2.sample.json)
- [Fixture de compatibilidade v1](../examples/floor01.sample.json)
- [JSON Schema](../schemas/saoData-v2.schema.json)

```powershell
npm run data:artifacts
npm run data:artifacts -- --check
npm run data:validate -- examples/floor01.v2.sample.json
```

O JSON Schema descreve os campos; refinamentos como ciclos, duplicações e referências são verificados pelo parser executável. `data:validate` relata hashes das fontes do backend e não afirma ter testado importação em banco.

## Migração de uma instalação

Faça backup completo com `pg_dump -Fc` e ensaie a restauração em outro banco. Mantenha os escritores parados durante a migração. `DATABASE_URL` deve apontar explicitamente para o banco escolhido. Não execute seed no banco existente: seed é para demonstração/testes e redefine usuários de demonstração.

```powershell
npm run db:generate
npm run db:migrate
npm run data:migrate
```

`db:migrate` adiciona `Entity.schemaVersion`, `Reference.slot`, índices e checks. Os registros antigos recebem versão 1; novas gravações usam 2. O comando de dados é dry-run por padrão e bloqueia aplicação se houver erros. Depois de revisar o relatório:

```powershell
npm run data:migrate -- --apply --backup data/backups/conteudo-antes-v2.json
node scripts/verify-data-migration.mjs data/backups/conteudo-antes-v2.json --export
```

O backup JSON é criado com exclusividade, sem sobrescrever arquivos existentes. Contém entidades com filhos, grants, auditoria e progresso. Ele complementa o dump completo. A transação compara versões/datas, verifica o conteúdo reconstruído de cada entidade e valida os checks do banco. Preserva IDs físicos existentes, IDs de domínio, datas, versões, soft-delete, grants, auditoria e progresso.

Use `--report caminho.json` para salvar o relatório em UTF-8, também sem sobrescrever um arquivo existente.

Quando há aliases conflitantes e a precedência canônica foi revisada, a opção explícita `--preserve-alias-conflicts` mantém o primeiro valor canônico e arquiva **todos os valores conflitantes** em `extensions.legacyConflicts`. O relatório identifica entidade, caminho e valores. Não remove destinos ausentes nem cria conteúdo fictício para resolver avisos.

O verificador compara conteúdo, IDs e metadados contra o backup; compara grants/auditoria/progresso; reexporta e reparsa cada campanha; exige diff `EQUAL` e nenhuma migração pendente. `--export` grava os pacotes junto ao backup. Atualize API e web juntas depois da verificação.

## Validação repetível

```powershell
npm test
npm run lint
npm run build
$env:TEST_DATABASE_URL = 'postgresql://usuario:senha@127.0.0.1:55439/banco_exclusivo_de_testes'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run db:migrate
npm run test:integration
```

Sem `TEST_DATABASE_URL`, os testes que exigem PostgreSQL são explicitamente ignorados. `test:integration` exige a variável e roda a suíte completa no banco indicado.

Para o fluxo E2E, prepare **somente o banco de testes**:

```powershell
npm run db:seed
npx playwright install chromium
$env:E2E_DATABASE_URL = $env:TEST_DATABASE_URL
$env:E2E_API_URL = 'http://127.0.0.1:3009'
$env:E2E_WEB_URL = 'http://127.0.0.1:5179'
npm run test:e2e
```

O Playwright inicia API e web isoladas, exercita GM/jogador, importação, descobertas, progresso, exportação v1/v2 e edição React. A campanha criada pelo teste é removida ao terminar.
